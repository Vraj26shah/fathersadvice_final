import express from 'express';
import User from '../models/User.js';
import MentorProfile from '../models/MentorProfile.js';
import MenteeProfile from '../models/MenteeProfile.js';
import ConnectionRequest from '../models/ConnectionRequest.js';
import ScheduledSession from '../models/ScheduledSession.js';
import Feedback from '../models/Feedback.js';
import { protect } from '../middleware/auth.js';
import { getIO, onlineUsers } from '../socket.js';
import { sendMail, emailAccepted } from '../utils/email.js';

const BASE_URL = process.env.APP_URL || 'http://localhost:5000';

const router = express.Router();

// All connect routes require authentication
router.use(protect);

// ─────────────────────────────────────────────────────────────────
// Weighted Bipartite Matching helpers  W_ij = α1·E_ij + α2·A_ij + α3·R_ij
// α1=0.5 (expertise), α2=0.3 (availability), α3=0.2 (rating)
// ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','all','can','her','was','one','our',
  'out','day','get','has','him','his','how','man','new','now','old','see','two',
  'way','who','boy','did','its','let','put','say','she','too','use','with','that',
  'this','have','from','they','will','been','more','when','your','what','some',
  'time','very','just','into','than','then','them','well','were','had','also',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// E_ij — expertise alignment via weighted cosine similarity
function computeExpertise(mentorProfile, menteeProfile) {
  const mentorTerms = {};
  for (const skill of mentorProfile.skills || []) {
    const weight = ((skill.proficiency || 3) / 5);
    for (const w of tokenize(skill.name)) {
      mentorTerms[w] = (mentorTerms[w] || 0) + weight;
    }
  }
  for (const w of tokenize(mentorProfile.expertiseDescription || '')) {
    mentorTerms[w] = (mentorTerms[w] || 0) + 0.3;
  }
  // domain keyword
  for (const w of tokenize(mentorProfile.domain || '')) {
    mentorTerms[w] = (mentorTerms[w] || 0) + 0.5;
  }

  const menteeTerms = {};
  for (const topic of menteeProfile.topics || []) {
    const weight = (4 - (topic.priority || 1)) / 3; // priority 1→1.0, 2→0.67, 3→0.33
    for (const w of tokenize(topic.name)) {
      menteeTerms[w] = (menteeTerms[w] || 0) + weight;
    }
  }
  for (const w of tokenize(menteeProfile.learningDescription || '')) {
    menteeTerms[w] = (menteeTerms[w] || 0) + 0.3;
  }
  for (const w of tokenize(menteeProfile.domain || '')) {
    menteeTerms[w] = (menteeTerms[w] || 0) + 0.5;
  }

  // Cosine similarity
  const allTerms = new Set([...Object.keys(mentorTerms), ...Object.keys(menteeTerms)]);
  let dot = 0, normA = 0, normB = 0;
  for (const t of allTerms) {
    const a = mentorTerms[t] || 0;
    const b = menteeTerms[t] || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Convert "HH:MM" → minutes since midnight
function timeToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

// A_ij — temporal availability via sliding-window slot overlap
function computeAvailability(mentorProfile, menteeProfile) {
  const mentorSlots = mentorProfile.slots || [];
  const menteeSlots = menteeProfile.slots || [];
  if (!mentorSlots.length || !menteeSlots.length) return 0.5; // neutral if no data

  let totalMentee = 0;
  let totalOverlap = 0;

  for (const ms of menteeSlots) {
    const msStart = timeToMin(ms.start);
    const msEnd   = timeToMin(ms.end);
    totalMentee += Math.max(0, msEnd - msStart);

    for (const ts of mentorSlots) {
      if (ts.day.toLowerCase() !== ms.day.toLowerCase()) continue;
      const tsStart = timeToMin(ts.start);
      const tsEnd   = timeToMin(ts.end);
      const ovStart = Math.max(msStart, tsStart);
      const ovEnd   = Math.min(msEnd, tsEnd);
      if (ovEnd > ovStart) totalOverlap += ovEnd - ovStart;
    }
  }

  if (!totalMentee) return 0.5;
  return Math.min(1, totalOverlap / totalMentee);
}

// W_ij = 0.5·E_ij + 0.3·A_ij + 0.2·R_ij  (R_ij = 0.7 neutral, no ratings yet)
// MAX_W normalised so a perfect mentor (E=1, A=1, R=1) scores 100%
const MAX_W = 0.5 + 0.3 + 0.2; // 1.0

// L_ij — language compatibility: 1 if shared language, 0.5 if no data, 0 if no match
function computeLanguageMatch(mentorLangs = [], menteeLangs = []) {
  if (!mentorLangs.length || !menteeLangs.length) return 0.5; // neutral
  const menteeSet = new Set(menteeLangs.map(l => l.toLowerCase().trim()));
  return mentorLangs.some(l => menteeSet.has(l.toLowerCase().trim())) ? 1 : 0;
}

// R defaults to 0.7 (neutral) when no feedback exists yet
function computeMatchScore(mentorProfile, menteeProfile, R = 0.7) {
  const E = computeExpertise(mentorProfile, menteeProfile);
  const A = computeAvailability(mentorProfile, menteeProfile);
  const W = 0.5 * E + 0.3 * A + 0.2 * R;
  return {
    matchScore:        Math.round((W / MAX_W) * 100),  // normalised 0–100
    expertiseScore:    Math.round(E * 100),
    availabilityScore: Math.round(A * 100),
    ratingScore:       Math.round(R * 100),
  };
}

// ─────────────────────────────────────────────────────────────────
// GET /api/connect/mentors
// Mentee: get list of all active mentors sorted by match score
// ─────────────────────────────────────────────────────────────────
router.get('/mentors', async (req, res) => {
  try {
    if (req.user.role !== 'mentee') {
      return res.status(403).json({ message: 'Only mentees can browse mentors.' });
    }

    // Load mentee's own profile for algorithm inputs
    const menteeProfile = await MenteeProfile.findOne({ user: req.user._id }).lean();

    // Get all mentor profiles with user info
    const profiles = await MentorProfile.find({ isActive: true })
      .populate('user', 'fullName profilePicture')
      .lean();

    // Get pending/accepted requests already sent by this mentee
    const myRequests = await ConnectionRequest.find({ mentee: req.user._id }).lean();
    const requestMap = {};
    myRequests.forEach(r => { requestMap[r.mentor.toString()] = r.status; });

    // Build a full request map: mentorId → { status, _id }
    const reqDetailMap = {};
    myRequests.forEach(r => { reqDetailMap[r.mentor.toString()] = { status: r.status, requestId: r._id.toString() }; });

    // Aggregate average feedback ratings for each mentor (R_ij)
    const mentorUserIds = profiles.map(p => p.user._id);
    const ratingAgg = await Feedback.aggregate([
      { $match: { to: { $in: mentorUserIds }, fromRole: 'mentee' } },
      { $group: { _id: '$to', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const ratingMap = {};
    ratingAgg.forEach(r => { ratingMap[r._id.toString()] = r.avgRating / 5; }); // normalise to 0–1

    const mentors = profiles.map(p => {
      // R_ij: use real avg rating if ≥1 review exists, else neutral 0.7
      const R = ratingMap[p.user._id.toString()] ?? 0.7;
      const scores = menteeProfile
        ? computeMatchScore(p, menteeProfile, R)
        : { matchScore: 0, expertiseScore: 0, availabilityScore: 50 };
      const L = computeLanguageMatch(p.languages, menteeProfile?.languages);
      // matchScore: 85% algorithm score + 15% language compatibility
      const blendedMatch = Math.round(scores.matchScore * 0.85 + L * 100 * 0.15);
      const reqInfo = reqDetailMap[p.user._id.toString()] || null;

      return {
        mentorId:          p.user._id,
        fullName:          p.user.fullName,
        profilePicture:    p.user.profilePicture,
        jobTitle:          p.jobTitle,
        organisation:      p.organisation,
        yearsExperience:   p.yearsExperience,
        domain:            p.domain,
        skills:            p.skills || [],
        languages:         p.languages || [],
        bio:               p.bio,
        requestStatus:     reqInfo?.status || null,
        requestId:         reqInfo?.requestId || null,
        matchScore:        blendedMatch,
        expertiseScore:    scores.expertiseScore,
        availabilityScore: scores.availabilityScore,
        languageMatch:     L === 1 ? 'full' : L === 0 ? 'none' : 'unknown',
        isVerified:        p.isVerified || false,
        verificationStatus: p.verificationStatus || 'unverified',
        ratingScore:       scores.ratingScore ?? 70,
      };
    });

    // Sort: accepted first → verified before unverified → by match score
    mentors.sort((a, b) => {
      if (a.requestStatus === 'accepted' && b.requestStatus !== 'accepted') return -1;
      if (b.requestStatus === 'accepted' && a.requestStatus !== 'accepted') return  1;
      if (a.isVerified && !b.isVerified) return -1;
      if (b.isVerified && !a.isVerified) return  1;
      return b.matchScore - a.matchScore;
    });

    res.json({ mentors });
  } catch (err) {
    console.error('GET /mentors error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/connect/mentees
// Mentor: get all mentee profiles ranked by match score
// ─────────────────────────────────────────────────────────────────
router.get('/mentees', async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can browse mentees.' });
    }

    const mentorProfile = await MentorProfile.findOne({ user: req.user._id }).lean();

    const profiles = await MenteeProfile.find()
      .populate('user', 'fullName profilePicture')
      .lean();

    // Requests from mentees to this mentor
    const myRequests = await ConnectionRequest.find({ mentor: req.user._id }).lean();
    const reqMap = {};
    myRequests.forEach(r => {
      reqMap[r.mentee.toString()] = { status: r.status, requestId: r._id.toString(), doubt: r.doubt };
    });

    const mentees = profiles.map(p => {
      if (!p.user) return null;
      const scores = mentorProfile
        ? computeMatchScore(mentorProfile, p)
        : { matchScore: 0, expertiseScore: 0, availabilityScore: 50 };
      const L = computeLanguageMatch(mentorProfile?.languages || [], p.languages || []);
      const blendedMatch = Math.round(scores.matchScore * 0.85 + L * 100 * 0.15);
      const reqInfo = reqMap[p.user._id.toString()] || null;

      return {
        menteeId:          p.user._id,
        fullName:          p.user.fullName,
        domain:            p.domain,
        bio:               p.bio,
        expLevel:          p.expLevel,
        roleStatus:        p.roleStatus,
        topics:            (p.topics || []).map(t => t.name),
        languages:         p.languages || [],
        matchScore:        blendedMatch,
        expertiseScore:    scores.expertiseScore,
        availabilityScore: scores.availabilityScore,
        languageMatch:     L === 1 ? 'full' : L === 0 ? 'none' : 'unknown',
        requestStatus:     reqInfo?.status || null,
        requestId:         reqInfo?.requestId || null,
        doubt:             reqInfo?.doubt || null,
      };
    }).filter(Boolean);

    // Sort: accepted first, then pending, then by match score
    mentees.sort((a, b) => {
      const order = { accepted: 0, pending: 1 };
      const oa = order[a.requestStatus] ?? 2;
      const ob = order[b.requestStatus] ?? 2;
      if (oa !== ob) return oa - ob;
      return b.matchScore - a.matchScore;
    });

    res.json({ mentees });
  } catch (err) {
    console.error('GET /mentees error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/connect/request
// Mentee: send a connection request to a mentor with a doubt
// Body: { mentorId, doubt }
// ─────────────────────────────────────────────────────────────────
router.post('/request', async (req, res) => {
  try {
    if (req.user.role !== 'mentee') {
      return res.status(403).json({ message: 'Only mentees can send requests.' });
    }

    const { mentorId, doubt } = req.body;

    if (!mentorId || !doubt || !doubt.trim()) {
      return res.status(400).json({ message: 'Mentor and doubt are required.' });
    }

    // Verify the mentor exists
    const mentor = await User.findOne({ _id: mentorId, role: 'mentor' });
    if (!mentor) {
      return res.status(404).json({ message: 'Mentor not found.' });
    }

    // Check if request already exists (unique index will also catch this)
    const existing = await ConnectionRequest.findOne({
      mentee: req.user._id,
      mentor: mentorId,
    });
    if (existing) {
      return res.status(409).json({ message: 'You have already sent a request to this mentor.' });
    }

    const request = await ConnectionRequest.create({
      mentee: req.user._id,
      mentor: mentorId,
      doubt:  doubt.trim(),
    });

    // Notify mentor in real-time with mentee details
    const menteeProfile = await MenteeProfile.findOne({ user: req.user._id })
      .select('languages')
      .lean();
    const io = getIO();
    const mentorIdStr = mentorId.toString();
    if (io && onlineUsers.has(mentorIdStr)) {
      io.to(onlineUsers.get(mentorIdStr)).emit('new_request', {
        requestId:  request._id.toString(),
        menteeName: req.user.fullName,
        doubt:      doubt.trim(),
        languages:  menteeProfile?.languages || [],
      });
    }

    res.status(201).json({ message: 'Request sent successfully.', requestId: request._id });
  } catch (err) {
    console.error('POST /request error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/connect/requests
// Mentor: get all pending connection requests sent to them
// ─────────────────────────────────────────────────────────────────
router.get('/requests', async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can view requests.' });
    }

    const requests = await ConnectionRequest.find({
      mentor: req.user._id,
      status: 'pending',
    })
      .populate('mentee', 'fullName profilePicture')
      .sort({ createdAt: -1 })
      .lean();

    // Fetch mentee profiles for languages
    const menteeIds = requests.map(r => r.mentee._id);
    const menteeProfiles = await MenteeProfile.find({ user: { $in: menteeIds } })
      .select('user languages')
      .lean();
    const menteeProfileMap = {};
    menteeProfiles.forEach(p => { menteeProfileMap[p.user.toString()] = p; });

    const result = requests.map(r => {
      const mp = menteeProfileMap[r.mentee._id.toString()] || {};
      return {
        requestId:    r._id,
        menteeId:     r.mentee._id,
        menteeName:   r.mentee.fullName,
        menteeAvatar: r.mentee.profilePicture,
        doubt:        r.doubt,
        languages:    mp.languages || [],
        sentAt:       r.createdAt,
      };
    });

    res.json({ requests: result });
  } catch (err) {
    console.error('GET /requests error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/connect/accept/:requestId
// Mentor: accept a pending request
// ─────────────────────────────────────────────────────────────────
router.post('/accept/:requestId', async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can accept requests.' });
    }

    const request = await ConnectionRequest.findOne({
      _id:    req.params.requestId,
      mentor: req.user._id,
      status: 'pending',
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found or already handled.' });
    }

    request.status = 'accepted';
    await request.save();

    // Fetch both parties for notification
    const mentee = await User.findById(request.mentee).select('fullName email').lean();
    const roomUrl    = `https://meet.jit.si/FathersAdvice-${request._id}`;
    const sessionUrl = `${BASE_URL}/session.html?requestId=${request._id}`;
    const menteeIdStr = request.mentee.toString();
    const menteeOnline = onlineUsers.has(menteeIdStr);

    // Fetch mentor profile for enriched notification payload
    const mentorProfile = await MentorProfile.findOne({ user: req.user._id })
      .select('isVerified domain languages')
      .lean();

    // ── Real-time: if mentee is online, push notification immediately ──
    const io = getIO();
    if (io && menteeOnline) {
      io.to(onlineUsers.get(menteeIdStr)).emit('request_accepted', {
        mentorName:  req.user.fullName,
        requestId:   request._id.toString(),
        roomUrl,
        sessionUrl,
        isVerified:  mentorProfile?.isVerified  || false,
        domain:      mentorProfile?.domain      || '',
        languages:   mentorProfile?.languages   || [],
        doubt:       request.doubt,
      });
    }

    // ── Email: always send (as a fallback / confirmation) ──────────────
    // Non-fatal: the request is already accepted in the DB, so an email failure must not fail the request.
    try {
      await sendMail({
        to:      mentee.email,
        subject: `🎉 ${req.user.fullName} accepted your mentorship request!`,
        html:    emailAccepted({
          menteeName: mentee.fullName,
          mentorName: req.user.fullName,
          sessionUrl,
        }),
      });
    } catch (mailErr) {
      console.error('POST /accept email error:', mailErr.message);
    }

    res.json({
      message:      'Request accepted.',
      menteeOnline,
      requestId:    request._id,
      roomUrl,
    });
  } catch (err) {
    console.error('POST /accept error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/connect/decline/:requestId
// Mentor: decline a pending request
// ─────────────────────────────────────────────────────────────────
router.post('/decline/:requestId', async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can decline requests.' });
    }

    const request = await ConnectionRequest.findOne({
      _id:    req.params.requestId,
      mentor: req.user._id,
      status: 'pending',
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found or already handled.' });
    }

    request.status = 'declined';
    await request.save();

    res.json({ message: 'Request declined.' });
  } catch (err) {
    console.error('POST /decline error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/connect/accepted
// Mentor: get all accepted connections (active mentees) with session link
// ─────────────────────────────────────────────────────────────────
router.get('/accepted', async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can view accepted connections.' });
    }

    const accepted = await ConnectionRequest.find({
      mentor: req.user._id,
      status: 'accepted',
    })
      .populate('mentee', 'fullName profilePicture')
      .sort({ updatedAt: -1 })
      .lean();

    const result = accepted.map(r => ({
      requestId:  r._id,
      menteeId:   r.mentee._id,
      menteeName: r.mentee.fullName,
      menteeAvatar: r.mentee.profilePicture,
      doubt:      r.doubt,
      acceptedAt: r.updatedAt,
      roomUrl:    `https://meet.jit.si/FathersAdvice-${r._id}`,
    }));

    res.json({ connections: result });
  } catch (err) {
    console.error('GET /accepted error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// Gemini helpers — temperature:0 = deterministic output
// ─────────────────────────────────────────────────────────────────

// In-memory cache: normalised doubt → { subjects, expiry }
const _subjectCache = new Map();

async function callGemini(prompt, maxTokens = 1000) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature:     0,          // deterministic — same doubt → same output every time
        maxOutputTokens: maxTokens,
      },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text.trim();
}

// Step 1: Given a doubt, identify the 5 most relevant subjects (cached 24 h)
async function extractSubjects(doubt) {
  const key = doubt.toLowerCase().trim();
  const hit  = _subjectCache.get(key);
  if (hit && Date.now() < hit.expiry) return hit.subjects;

  const prompt =
`You are a mentorship topic classifier. Given this doubt:
"${key}"

Identify exactly 5 subject areas most relevant to answering it.
Return ONLY valid JSON, no markdown, no explanation:
{"subjects":[{"name":"<subject>","relevance":<integer 0-100>},...]}

Rules:
- Exactly 5 subjects, ordered by relevance descending.
- Relevance values must be integers that sum to 100.`;

  const raw   = await callGemini(prompt, 350);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Nemotron: could not parse subjects JSON');

  let subjects = JSON.parse(match[0]).subjects.slice(0, 5).map(s => ({
    name:      String(s.name).slice(0, 60),
    relevance: Math.min(100, Math.max(0, Math.round(Number(s.relevance) || 0))),
  }));

  // Normalise so relevances sum to 100
  const total = subjects.reduce((acc, s) => acc + s.relevance, 0) || 1;
  subjects = subjects.map(s => ({ ...s, relevance: Math.round((s.relevance / total) * 100) }));

  _subjectCache.set(key, { subjects, expiry: Date.now() + 24 * 60 * 60 * 1000 });
  return subjects;
}

// Step 2: Score all mentors on the extracted subjects in a single batched call
async function scoreMentorsOnSubjects(summaries, subjects) {
  const subjectNames = subjects.map(s => s.name);
  const mentorLines  = summaries
    .map(m => `ID:${m.id} | Domain:${m.domain} | Skills:${m.skills} | Bio:${m.bio} | Expertise:${m.expertise}`)
    .join('\n');

  const prompt =
`Score each mentor's expertise in these 5 subjects (0-100 scale).
Use ONLY their domain, skills, bio, and expertise text — nothing else.

SUBJECTS: ${subjectNames.join(' | ')}

MENTORS:
${mentorLines}

Return ONLY a valid JSON array. No markdown, no explanation.
Format: [{"id":"<mentorId>","scores":{"${subjectNames[0]}":0-100,"${subjectNames[1] || 'S2'}":0-100,...}},...]
Use the exact subject names as keys. Scores are integers 0-100.`;

  const maxTokens = Math.min(4000, 500 + summaries.length * 150);
  const raw   = await callGemini(prompt, maxTokens);
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Nemotron: could not parse mentor scores JSON');

  const parsed   = JSON.parse(match[0]);
  const scoreMap = {};
  for (const entry of parsed) {
    scoreMap[entry.id] = {};
    for (const s of subjects) {
      // Case-insensitive key lookup for robustness
      const val = entry.scores?.[s.name]
        ?? Object.entries(entry.scores || {}).find(([k]) => k.toLowerCase() === s.name.toLowerCase())?.[1]
        ?? 0;
      scoreMap[entry.id][s.name] = Math.min(100, Math.max(0, Math.round(Number(val) || 0)));
    }
  }
  return scoreMap;
}

// ─────────────────────────────────────────────────────────────────
// POST /api/connect/ai-score
// Mentee sends doubt → Nemotron extracts 5 subjects → scores every
// mentor on those subjects → applies W_ij algorithm → returns ranked list
// Body: { doubt }
// ─────────────────────────────────────────────────────────────────
router.post('/ai-score', async (req, res) => {
  try {
    if (req.user.role !== 'mentee') {
      return res.status(403).json({ message: 'Only mentees can use AI scoring.' });
    }
    const { doubt } = req.body;
    if (!doubt?.trim()) {
      return res.status(400).json({ message: 'Doubt text is required.' });
    }

    const [menteeProfile, profiles, myRequests] = await Promise.all([
      MenteeProfile.findOne({ user: req.user._id }).lean(),
      MentorProfile.find({ isActive: true }).populate('user', 'fullName profilePicture').lean(),
      ConnectionRequest.find({ mentee: req.user._id }).lean(),
    ]);

    const reqDetailMap = {};
    myRequests.forEach(r => { reqDetailMap[r.mentor.toString()] = { status: r.status, requestId: r._id.toString() }; });

    // Real average feedback ratings (R_ij) — same source of truth as GET /mentors
    const mentorUserIds = profiles.map(p => p.user._id);
    const ratingAgg = await Feedback.aggregate([
      { $match: { to: { $in: mentorUserIds }, fromRole: 'mentee' } },
      { $group: { _id: '$to', avgRating: { $avg: '$rating' } } },
    ]);
    const ratingMap = {};
    ratingAgg.forEach(r => { ratingMap[r._id.toString()] = r.avgRating / 5; });

    const summaries = profiles.map(p => ({
      id:        p.user._id.toString(),
      name:      p.user.fullName,
      domain:    p.domain || '',
      skills:    (p.skills || []).map(s => s.name).join(', '),
      bio:       (p.bio || '').slice(0, 160),
      expertise: (p.expertiseDescription || '').slice(0, 160),
    }));

    // ── Nemotron: step 1 + step 2 ────────────────────────────────
    let subjects      = [];
    let mentorScoreMap = {};

    try {
      // Step 1 — Extract 5 relevant subjects from the doubt (temperature=0, cached)
      subjects = await extractSubjects(doubt.trim());

      // Step 2 — Score every mentor on those subjects (temperature=0 → same scores every time)
      mentorScoreMap = await scoreMentorsOnSubjects(summaries, subjects);
    } catch (aiErr) {
      console.warn('Gemini AI scoring failed, falling back to TF-IDF:', aiErr.message);
      // Fallback: distribute TF-IDF expertise score evenly across blank subjects
      subjects = [{ name: 'Overall Expertise', relevance: 100 }];
      profiles.forEach(p => {
        const base = menteeProfile ? computeMatchScore(p, menteeProfile) : { expertiseScore: 0 };
        mentorScoreMap[p.user._id.toString()] = { 'Overall Expertise': base.expertiseScore };
      });
    }

    // ── Step 3: Compute scores ──────────────────────────────────────────────
    // matchScore  = simple average of all 5 subject scores (direct doubt alignment)
    // expertiseScore = relevance-weighted average (finer measure, shown in bars)
    // availabilityScore = temporal slot overlap
    // W_ij is still computed internally and used only for sort-order tiebreaking
    const totalRel = subjects.reduce((acc, s) => acc + s.relevance, 0) || 1;

    const mentors = profiles.map(p => {
      const mid       = p.user._id.toString();
      const subScores = mentorScoreMap[mid] || {};

      // Average of all subject scores
      const rawSubjectAvg = subjects.length
        ? subjects.reduce((acc, s) => acc + (subScores[s.name] || 0), 0) / subjects.length
        : 0;

      // Language compatibility (L_ij) blended in: 85% subject avg + 15% language
      const L = computeLanguageMatch(p.languages, menteeProfile?.languages);
      const subjectAvg = Math.round(rawSubjectAvg * 0.85 + L * 100 * 0.15);

      // Relevance-weighted expertise (used in the subject bars)
      const weightedSum  = subjects.reduce((acc, s) => acc + s.relevance * (subScores[s.name] || 0), 0);
      const aiE          = weightedSum / (totalRel * 100);  // 0–1

      const baseA   = menteeProfile ? computeAvailability(p, menteeProfile) : 0.5;
      const R       = ratingMap[mid] ?? 0.7;
      const W       = 0.5 * aiE + 0.3 * baseA + 0.2 * R;  // W_ij for sort tiebreak
      const reqInfo = reqDetailMap[mid] || null;

      return {
        mentorId:          p.user._id,
        fullName:          p.user.fullName,
        profilePicture:    p.user.profilePicture,
        jobTitle:          p.jobTitle,
        organisation:      p.organisation,
        yearsExperience:   p.yearsExperience,
        domain:            p.domain,
        skills:            p.skills || [],
        languages:         p.languages || [],
        bio:               p.bio,
        requestStatus:     reqInfo?.status || null,
        requestId:         reqInfo?.requestId || null,
        matchScore:        subjectAvg,                       // avg of all subject %
        expertiseScore:    Math.round(aiE * 100),            // relevance-weighted
        availabilityScore: Math.round(baseA * 100),
        ratingScore:       Math.round(R * 100),
        subjectScores:     subScores,
        languageMatch:     L === 1 ? 'full' : L === 0 ? 'none' : 'unknown',
        isVerified:        p.isVerified || false,
        verificationStatus: p.verificationStatus || 'unverified',
        _sortW:            W,
        aiPowered:         true,
      };
    });

    // Sort: accepted first → verified before unverified → by displayed match score,
    // with W_ij (relevance-weighted expertise + availability + rating) as a tiebreaker.
    mentors.sort((a, b) => {
      if (a.requestStatus === 'accepted' && b.requestStatus !== 'accepted') return -1;
      if (b.requestStatus === 'accepted' && a.requestStatus !== 'accepted') return  1;
      if (a.isVerified && !b.isVerified) return -1;
      if (b.isVerified && !a.isVerified) return  1;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return b._sortW - a._sortW;
    });

    // Remove internal sort key before sending to client
    mentors.forEach(m => delete m._sortW);

    res.json({ mentors, subjects, aiPowered: true });
  } catch (err) {
    console.error('POST /ai-score error:', err);
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/connect/session/:requestId
// Returns Jitsi room URL for an accepted connection (both parties)
// ─────────────────────────────────────────────────────────────────
router.get('/session/:requestId', async (req, res) => {
  try {
    const request = await ConnectionRequest.findById(req.params.requestId)
      .populate('mentor', 'fullName')
      .populate('mentee', 'fullName')
      .lean();

    if (!request) return res.status(404).json({ message: 'Session not found.' });

    const uid = req.user._id.toString();
    const isMentor = request.mentor._id.toString() === uid;
    const isMentee = request.mentee._id.toString() === uid;
    if (!isMentor && !isMentee) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    if (request.status !== 'accepted') {
      return res.status(400).json({ message: 'Session is only available for accepted connections.' });
    }

    // Deterministic room name from request ID — no API key needed for Jitsi
    const roomName  = `FathersAdvice-${req.params.requestId}`;
    const roomUrl   = `https://meet.jit.si/${roomName}`;

    // Find the latest confirmed (or proposed) session for this connection
    const latestSession = await ScheduledSession.findOne({
      request: req.params.requestId,
      status:  { $in: ['confirmed', 'proposed'] },
    }).sort({ scheduledTime: -1 }).lean();

    res.json({
      roomUrl,
      roomName,
      mentorName: request.mentor.fullName,
      menteeName: request.mentee.fullName,
      doubt:      request.doubt,
      requestId:  request._id,
      sessionId:  latestSession?._id || null,
    });
  } catch (err) {
    console.error('GET /session error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/connect/:requestId
// Either party calls this after a session ends to reset the connection.
// Deletes the ConnectionRequest + all related ScheduledSessions.
// Feedback records are kept for history.
// ─────────────────────────────────────────────────────────────────
router.delete('/:requestId', async (req, res) => {
  try {
    const conn = await ConnectionRequest.findOne({
      _id: req.params.requestId,
      $or: [{ mentor: req.user._id }, { mentee: req.user._id }],
    });
    if (!conn) return res.status(404).json({ message: 'Connection not found.' });

    const mentorId = conn.mentor.toString();
    const menteeId = conn.mentee.toString();

    await ScheduledSession.deleteMany({ request: conn._id });
    await conn.deleteOne();

    // Notify both parties so their open pages update in real-time
    const io = getIO();
    const payload = { mentorUserId: mentorId, menteeUserId: menteeId };
    [mentorId, menteeId].forEach(uid => {
      const sid = onlineUsers.get(uid);
      if (sid) io.to(sid).emit('connection_reset', payload);
    });

    res.json({ message: 'Connection reset. Both parties can connect again.' });
  } catch (err) {
    console.error('DELETE /connect error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/connect/mentor-reviews
// Returns feedback received by the logged-in mentor, with averages.
// ─────────────────────────────────────────────────────────────────
router.get('/mentor-reviews', async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can view their reviews.' });
    }
    const reviews = await Feedback.find({ to: req.user._id, fromRole: 'mentee' })
      .populate('from', 'fullName profilePicture')
      .sort({ createdAt: -1 })
      .lean();

    const avg = reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : null;

    res.json({ reviews, avg, count: reviews.length });
  } catch (err) {
    console.error('GET /mentor-reviews error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

export default router;
