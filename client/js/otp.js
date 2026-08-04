/* Shared OTP verification logic — used by signup-mentor.html and signup-mentee.html.
   Relies on globals each host page defines: val(id), goToStep(step), currentStep,
   emailVerified — all classic <script> globals, resolved at call time (after a user
   interaction), so load order relative to the page's own inline script doesn't matter. */

let otpResendUntil = 0;
let otpResendTimer = null;

function startResendCooldown(seconds = 60) {
  otpResendUntil = Date.now() + seconds * 1000;
  const resendBtn = document.getElementById('otp-resend-btn');
  const resendText = document.getElementById('otp-resend-text');
  clearInterval(otpResendTimer);
  const update = () => {
    const remaining = Math.max(0, Math.ceil((otpResendUntil - Date.now()) / 1000));
    if (resendBtn) resendBtn.disabled = remaining > 0;
    if (resendText) resendText.textContent = remaining ? `Didn't receive it? Resend in ${remaining}s` : "Didn't receive it?";
    if (!remaining) clearInterval(otpResendTimer);
  };
  update();
  otpResendTimer = setInterval(update, 250);
}

async function sendOtp() {
  const email     = val('email');
  const overlay   = document.getElementById('otp-overlay');
  const errEl     = document.getElementById('otp-err');
  const subEl     = document.getElementById('otp-sub');
  const verifyBtn = document.getElementById('otp-verify-btn');
  const boxes     = document.querySelectorAll('.otp-box');

  errEl.textContent  = '';
  errEl.style.color  = '#e05c5c';
  boxes.forEach(b => { b.value = ''; b.classList.remove('error'); });
  subEl.innerHTML    = `Sending code to <strong>${email}</strong>…`;
  verifyBtn.disabled = true;
  overlay.classList.remove('hidden');

  try {
    const res  = await fetch('/api/auth/send-otp', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        // Account already exists — send them to sign in instead of letting them retry here.
        window.location.href = `login.html?email=${encodeURIComponent(email)}&existing=1`;
        return;
      }
      errEl.textContent  = data.message || 'Failed to send code.';
      subEl.innerHTML    = `Could not send to <strong>${email}</strong> — fix the issue and resend.`;
      verifyBtn.disabled = false;
      return;
    }
    if (data.devOtp) {
      // Demo mode — the server couldn't email the code, so it handed it back
      // for us to fill in. Show it plainly rather than pretending mail was sent.
      String(data.devOtp).split('').forEach((d, i) => { if (boxes[i]) boxes[i].value = d; });
      subEl.innerHTML    = `Demo mode — no email sent to <strong>${email}</strong>`;
      errEl.style.color  = '#4ade80';
      errEl.textContent  = '⚡ Code filled in automatically — click Verify email';
      verifyBtn.disabled = false;
      startResendCooldown();
      verifyBtn.focus();
      return;
    }
    subEl.innerHTML    = `We sent a 6-digit code to <strong>${email}</strong>`;
    verifyBtn.disabled = false;
    startResendCooldown();
    boxes[0] && boxes[0].focus();
  } catch {
    errEl.textContent  = 'Network error — is the server running?';
    subEl.innerHTML    = `Could not reach server`;
    verifyBtn.disabled = false;
  }
}

async function verifyOtp() {
  const email  = val('email');
  const boxes  = document.querySelectorAll('.otp-box');
  const otp    = Array.from(boxes).map(b => b.value.trim()).join('');
  const errEl  = document.getElementById('otp-err');
  const btn    = document.getElementById('otp-verify-btn');

  boxes.forEach(b => b.classList.remove('error'));
  errEl.textContent = '';

  if (otp.length !== 6) {
    boxes.forEach(b => b.classList.add('error'));
    errEl.textContent = 'Please enter all 6 digits.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    const res  = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    const data = await res.json();

    if (res.ok && data.verified) {
      emailVerified = true;
      document.getElementById('otp-overlay').classList.add('hidden');
      goToStep(currentStep + 1);
    } else {
      boxes.forEach(b => b.classList.add('error'));
      errEl.textContent = data.message || 'Incorrect code.';
      btn.disabled = false;
      btn.textContent = 'Verify email';
    }
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Verify email';
  }
}

// OTP box auto-advance — use event delegation so it works even though
// the overlay HTML is rendered after this script loads
document.addEventListener('input', e => {
  if (!e.target.classList.contains('otp-box')) return;
  const box   = e.target;
  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  const i     = boxes.indexOf(box);
  box.value   = box.value.replace(/\D/g, '').slice(-1);
  if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
});
document.addEventListener('keydown', e => {
  if (!e.target.classList.contains('otp-box')) return;
  const box   = e.target;
  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  const i     = boxes.indexOf(box);
  if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
});
document.addEventListener('paste', e => {
  if (!e.target.classList.contains('otp-box')) return;
  e.preventDefault();
  const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
  const boxes  = Array.from(document.querySelectorAll('.otp-box'));
  boxes.forEach(b => b.value = '');
  digits.split('').forEach((d, j) => { if (boxes[j]) boxes[j].value = d; });
  const next = boxes[Math.min(digits.length, 5)];
  if (next) next.focus();
});

// Button clicks — delegated so they work even though the overlay HTML
// is rendered after this script loads
document.addEventListener('click', async e => {
  const id = e.target.id;

  if (id === 'otp-verify-btn') {
    verifyOtp();
    return;
  }

  if (id === 'otp-resend-btn') {
    if (Date.now() < otpResendUntil) return;
    document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.classList.remove('error'); });
    const errEl = document.getElementById('otp-err');
    errEl.textContent = '';
    errEl.style.color = '#e05c5c';
    await sendOtp();
    return;
  }

  if (id === 'otp-back-btn') {
    document.getElementById('otp-overlay').classList.add('hidden');
  }
});
