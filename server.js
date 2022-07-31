const DOMAIN = "wp-rest.appgalleria.com";
const BASE_URL = "https://wp-rest.appgalleria.com";
const REST_URL = "https://pymnts.com";
const SECRET_KEY = 'ksdndkklw4890dfio409dfjoe0509e5oifdhrehhioers';

// import required packages
const serializerr = require('serializerr');
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

const processRequest = async (endpoint, baseKey, req, successCallback, res = null, errorCallback = null) => {
    console.log('processRequest', endpoint);
    let key = baseKey;

    const urlParams = Object.keys(req.params);
    for (let i = 0; i < urlParams.length; ++i) key += `::${sanitizeString(urlParams[i])}:${sanitizeString(req.params[urlParams[i]])}`;

    const queryParams = Object.keys(req.query);
    for (let i = 0; i < queryParams.length; ++i) key += `::${sanitizeString(queryParams[i])}:${sanitizeString(req.query[queryParams[i]])}`;
    
    // check if key is in redis. If so send the JSON parsed result and we are done.
    const redisVal = await redis.get(key);
    if (redisVal) return successCallback(key, JSON.parse(redisVal), res);

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

    console.log('request', request);
    
    //console.log(endpoint, key);

    axios(request)
    .then(response => {
        const { data } = response;
        redis.set(key, JSON.stringify(data));
        return successCallback(key, data, res);
        
    })
    .catch(err => {
        console.error(serializerr(err));
        if (errorCallback) errorCallback(key, err, res);
    })
}

const successfulGet = (key, data, res) => {
    return res.status(200).json(data);
}

const unsuccessfulGet = (key, err, res) => {
    return res.status(400).send('invalid request');
}

const handleGet = (endpoint, baseKey, req, res) => {
    processRequest(endpoint, baseKey, req, successfulGet, res, unsuccessfulGet);
}

// Generic WP REST API endpoints

app.get('/wp-json/wp/v2/posts/:id',  (req, res) => handleGet('/wp-json/wp/v2/posts/:id', 'postsId', req, res));
app.get('/wp-json/wp/v2/posts',  (req, res) => handleGet ('/wp-json/wp/v2/posts', 'posts', req, res));

app.get('/wp-json/wp/v2/categories/:id',  (req, res) => handleGet('/wp-json/wp/v2/categories/:id', 'categoriesId', req, res));
app.get('/wp-json/wp/v2/categories/',  (req, res) => handleGet('/wp-json/wp/v2/categories/', 'categories', req, res));

app.get('/wp-json/wp/v2/tags/:id',  (req, res) => handleGet('/wp-json/wp/v2/tags/:id', 'tagsId', req, res));
app.get('/wp-json/wp/v2/tags/',  (req, res) => handleGet('/wp-json/wp/v2/tags/', 'tags', req, res));

app.get('/wp-json/wp/v2/pages/:id',  (req, res) => handleGet('/wp-json/wp/v2/pages/:id', 'pagesId', req, res));
app.get('/wp-json/wp/v2/pages/',  (req, res) => handleGet('/wp-json/wp/v2/pages/', 'pages', req, res));

app.get('/wp-json/wp/v2/comments/:id',  (req, res) => handleGet('/wp-json/wp/v2/comments/:id', 'commentsId', req, res));
app.get('/wp-json/wp/v2/comments/',  (req, res) => handleGet('/wp-json/wp/v2/comments/', 'comments', req, res));

app.get('/wp-json/wp/v2/taxonomies/:id',  (req, res) => handleGet('/wp-json/wp/v2/taxonomies/:id', 'taxonomiesId', req, res));
app.get('/wp-json/wp/v2/taxonomies/',  (req, res) => handleGet('/wp-json/wp/v2/taxonomies/', 'taxonomies', req, res));

app.get('/wp-json/wp/v2/media/:id',  (req, res) => handleGet('/wp-json/wp/v2/media/:id', 'mediaId', req, res));
app.get('/wp-json/wp/v2/media/',  (req, res) => handleGet('/wp-json/wp/v2/media/', 'media', req, res));

app.get('/wp-json/wp/v2/types/:id',  (req, res) => handleGet('/wp-json/wp/v2/types/:id', 'typesId', req, res));
app.get('/wp-json/wp/v2/types/',  (req, res) => handleGet('/wp-json/wp/v2/types/', 'types', req, res));

app.get('/wp-json/wp/v2/search/',  (req, res) => handleGet('/wp-json/wp/v2/search/', 'search', req, res));

// Custom endpoints

// app.get('/wp-json/wp/v2/custom/page-of-posts/:curPage/:numPerPage', (req, res) => {
//     let endpoint = '/wp-json/wp/v2/posts';
//     let baseKey = 'posts';
//     let request = {
//         query: {
//             type: 'posts',
//             per_page: req.params.numPerPage,
//             page: req.params.curPage
//         }
//     }
//     result = aw
// });


const httpsServer = https.createServer({
  key: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/privkey.pem`),
  cert: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`),
}, app);


httpsServer.listen(5000, () => {
    console.log('HTTPS Server running on port 5000');
});