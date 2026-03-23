const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Headers to mimic a mobile browser
const getHeaders = () => ({
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9',
  'dpr': '1',
  'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-model': '"Nexus 5"',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  'viewport-width': '1000',
});

// Recursively extract highest resolution image URLs from timeline data
function extractImageUrls(obj, urls = {}) {
  if (obj && typeof obj === 'object') {
    // Check for post with image_versions2
    if (obj.pk && typeof obj.pk === 'string' && obj.image_versions2?.candidates) {
      const candidates = obj.image_versions2.candidates;
      const highest = candidates.reduce((max, cur) =>
        (cur.width * cur.height) > (max.width * max.height) ? cur : max, candidates[0]);
      if (highest?.url) {
        urls[obj.pk] = highest.url;
      }
    }
    // Recursively traverse
    for (const key in obj) {
      extractImageUrls(obj[key], urls);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach(item => extractImageUrls(item, urls));
  }
  return urls;
}

// API endpoint to fetch Instagram profile data
app.post('/api/fetch', async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const url = `https://www.instagram.com/${username}/`;
    const response = await axios.get(url, {
      headers: getHeaders(),
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    let timelineData = null;

    // Find script tags with application/json containing timeline data
    $('script[type="application/json"]').each((i, elem) => {
      const content = $(elem).html();
      if (content && content.includes('polaris_timeline_connection') && content.includes('image_versions2')) {
        try {
          timelineData = JSON.parse(content);
          return false; // break loop
        } catch (e) {
          // ignore parse errors
        }
      }
    });

    if (!timelineData) {
      return res.status(404).json({ error: 'No posts found or account is private' });
    }

    const imageUrls = extractImageUrls(timelineData);
    const posts = Object.entries(imageUrls).map(([postId, url]) => ({ postId, url }));

    if (posts.length === 0) {
      return res.status(404).json({ error: 'No images found in this profile' });
    }

    res.json({ success: true, username, posts, total: posts.length });

  } catch (error) {
    console.error('Error fetching profile:', error.message);
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'Username not found' });
    }
    res.status(500).json({ error: 'Failed to fetch profile data' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});