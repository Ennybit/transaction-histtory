import express from 'express';
import mongoose from 'mongoose';
import dotenv from "dotenv";
// import path from 'path';
const app = express();
const port = process.env.PORT || 3000;
dotenv.config();
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define the schema and model for your progress data
const progressSchema = new mongoose.Schema({
  goal: Number,
  currentProgress: Number
});
const Progress = mongoose.model('Progress', progressSchema);

app.use(express.static('public'));
app.use(express.json());

// API endpoint to get the current progress
app.get('/api/progress', async (req, res) => {
  try {
    const data = await Progress.findOne({}); // Find the single progress document
    res.json(data || { goal: 0, currentProgress: 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// API endpoint to save the progress
app.post('/api/progress', async (req, res) => {
  try {
    const { goal, currentProgress } = req.body;
    // Find and update, or create if it doesn't exist
    const result = await Progress.findOneAndUpdate(
      {}, // an empty filter to find the first document
      { goal, currentProgress },
      { upsert: true, new: true } // 'upsert' creates if not found, 'new' returns the updated doc
    );
    res.status(200).json({ message: 'Progress saved successfully!', data: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});