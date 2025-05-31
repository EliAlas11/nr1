
const express = require('express');
const router = express.Router();

// Route for getting video information
router.get('/videos/:id', (req, res) => {
  const { id } = req.params;
  
  // In a real implementation, this would fetch video data
  res.json({
    id: id,
    title: 'Sample Video',
    status: 'processed',
    url: `/videos/processed/${id}.mp4`
  });
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
