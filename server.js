const DOMAIN = "wp-rest.appgalleria.com";
const BASE_URL = "https://wp-rest.appgalleria.com";
const REST_URL = "https://pymnts.com";
const SECRET_KEY = 'ksdndkklw4890dfio409dfjoe0509e5oifdhrehhioers';

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

/*
 * POSTS endpoint
 * GET /wp/v2/posts
 * https://developer.wordpress.org/rest-api/reference/posts/
 */

// need to escape " and \ and all control characters such as \n,\t
// try encodeURIComponent for now

const sanitizeString = str => {

    return encodeURIComponent(str);
}

const handleGet = async (endpoint, baseKey, req, res) => {
    // generate a unique key
    let key = baseKey;
    
        // add any key/value pairs from the query parameters
        const queryParams = Object.keys(req.query);
        for (let i = 0; i < queryParams.length; ++i) key += `::${sanitizeString(queryParams[i])}:${sanitizeString(req.query[queryParams[i]])}`;
            
        // add any key/value pairs from the url route params (e.g. /:id)
        const urlParams = Object.keys(req.params);
        for (let i = 0; i < urlParams.length; ++i) key += `::${sanitizeString(urlParams[i])}:${sanitizeString(req.params[urlParams[i]])}`;
            
    // check if key is in redis. If so send the JSON parsed result and we are done.
    const redisVal = await redis.get(key);
    if (redisVal) return res.status(200).json(JSON.parse(redisVal));

    // if there are url params then replace the params in the endpoint. E.g. replace :id with the id value itself.
    for (let i = 0; i < urlParams.length; ++i) endpoint = endpoint.replace(`/:${urlParams[i]}`, `/${req.params[urlParams[i]]}`);

    // format the request
    let request = {};
    if (queryParams.length) {
        request = {
            url: `${REST_URL}${endpoint}`,
            method: 'get',
            params: req.query
        }
    } else {
        request = {
            url: `${REST_URL}${endpoint}`,
            method: 'get'
        }
    }

    // make the request

    //console.log(endpoint, key);
    axios(request)
    .then(response => {
        redis.set(key, JSON.stringify(response.data));
        res.status(200).json(response.data);
    })
    .catch(err => {
        console.error(`${req.url}: error!`);
        res.status(400).json(err.response.data);
    })
}

app.get('/wp-json/wp/v2/posts', async (req, res) => handleGet ('/wp-json/wp/v2/posts', 'posts', req, res));

app.get('/wp-json/wp/v2/media/:id', async (req, res) => handleGet('/wp-json/wp/v2/media/:id', 'mediaId', req, res));
   
app.get('/wp-json/wp/v2/categories/:id', async (req, res) => handleGet('/wp-json/wp/v2/categories/:id', 'categoriesId', req, res));

const httpsServer = https.createServer({
  key: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/privkey.pem`),
  cert: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`),
}, app);


httpsServer.listen(5000, () => {
    console.log('HTTPS Server running on port 5000');
});