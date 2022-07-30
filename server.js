const DOMAIN = "wp-rest.appgalleria.com";
const BASE_URL = "https://wp-rest.appgalleria.com";
const REST_URL = "https://pymnts.com";
const SECRET_KEY = 'ksdndkklw4890dfio409dfjoe0509e5oifdhrehhioer';

// import required packages
const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const { application } = require('express');
const axios = require('axios');

const redisPackage = require('redis');
const redis = redisPackage.createClient();
redis.on('connect', async () => {
    console.log('redis connected!');
});
redis.connect();

// create new express app and save it as "app"
const app = express();

// monitor urls being requested
// app.use((req, res, next) => {
//     console.log(req.url);
//     next();
// });

app.use(express.json({limit: '200mb'}));
app.use(cors());

// create a route for the app
app.get('/', (req, res) => {
  res.send('Hello dev.to!');
});

// 1) Serve as a passthrough
// 2) Add standard REDIS caching
// 3) Add custom route to reduce API calls to one per need
// 4) Add plugin hooks for realtime updating of keys

// IMPORTANT: Add a route with api-key for when a new post is created. Add a field to all posts that calls this route whenever a new post is created or updated

// ?type=posts&per_page=21&page=2

// posts/:perPage/:curPage

// updatePosts/ api-key


const isAlphanumeric = str => {
    if (str.match(/^[0-9a-z]+$/i)) return true;
    return false;
}

app.get('/reset-post-keys', (req, res) => {
    let { key } = req.query;

    if (!key) key = 'empty';

    res.status(200).send(key);
});

app.get('/wp-json/wp/v2/posts', async (req, res) => {
    const { type, per_page, page } = req.query;

    if (!type) return res.status(400).send('missing type');
    if (!per_page) return res.status(400).send('missing per_page');
    if (!page) return res.status(400).send('missing page');

    const key = `${type}:${per_page}:${page}`;
    const redisVal = await redis.get(key);
    if (redisVal) return res.status(200).json(JSON.parse(redisVal));

    const request = {
        url: `${REST_URL}/wp-json/wp/v2/posts`,
        method: 'get',
        params: req.query
    };

    axios(request)
    .then(response => {
        //console.log(`${req.url}: success! ${typeof response.data}`);
        redis.set(key, JSON.stringify(response.data));
        res.status(200).json(response.data);
    })
    .catch(err => {
        console.error(`${req.url}: error!`);
        res.status(400).json(err.response.data);
    })
});

app.get('/wp-json/wp/v2/media/:id', async (req, res) => {
    const { id } = req.params;

    const request = {
        url: `${REST_URL}/wp-json/wp/v2/media/${id}`,
        method: 'get'
    };

    const key = `media:${id}`;
    const redisVal = await redis.get(key);
    if (redisVal) return res.status(200).json(JSON.parse(redisVal));

    axios(request)
    .then(response => {
        //console.log(`${req.url}: success! ${typeof response.data}`);
        redis.set(key, JSON.stringify(response.data));
        res.status(200).json(response.data);
    })
    .catch(err => {
        console.error(`${req.url}: error!`);
        res.status(400).json(err.response.data);
    })
});

app.get('/wp-json/wp/v2/categories/:id', async (req, res) => {
    const { id } = req.params;

    const request = {
        url: `${REST_URL}/wp-json/wp/v2/categories/${id}`,
        method: 'get'
    };

    const key = `categories:${id}`;
    const redisVal = await redis.get(key);
    if (redisVal) return res.status(200).json(JSON.parse(redisVal));

    axios(request)
    .then(response => {
       //console.log(`${req.url}: success!`);
        redis.set(key, JSON.stringify(response.data));
        res.status(200).json(response.data);
    })
    .catch(err => {
        console.error(`${req.url}: error!`);
        res.status(400).json(err.response.data);
    })
})

const httpsServer = https.createServer({
  key: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/privkey.pem`),
  cert: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`),
}, app);


httpsServer.listen(5000, () => {
    console.log('HTTPS Server running on port 5000');
});