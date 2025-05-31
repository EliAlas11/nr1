
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Route for getting video information
router.get('/videos/:id', (req, res) => {
  const { id } = req.params;
  
  // Serve the processed video file
  const videoPath = path.join(__dirname, '..', 'videos', 'processed', `${id}.mp4`);
  
  if (fs.existsSync(videoPath)) {
    res.sendFile(videoPath);
  } else {
    // Fallback to sample video
    const samplePath = path.join(__dirname, '..', 'videos', 'sample.mp4');
    if (fs.existsSync(samplePath)) {
      res.sendFile(samplePath);
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  }
});

// Route for video processing status
router.get('/status/:id', (req, res) => {
  const { id } = req.params;
  
  res.json({
    id: id,
    status: 'completed',
    progress: 100
  });
});

module.exports = router;
