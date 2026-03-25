import mongoose from 'mongoose';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

// Connect to MongoDB Atlas cluster — retries up to MAX_RETRIES times
const connectDB = async (attempt = 1) => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`  ✓ MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`  ✗ MongoDB connection failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
    if (attempt < MAX_RETRIES) {
      console.log(`    Retrying in ${RETRY_DELAY_MS / 1000}s…`);
      setTimeout(() => connectDB(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error('  ✗ Could not connect to MongoDB after multiple attempts. Server will continue but DB calls will fail.');
    }
  }
};

export default connectDB;
