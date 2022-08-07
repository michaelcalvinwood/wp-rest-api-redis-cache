let defaultTTLMinutes = 30;
let refreshTTLMinutes = defaultTTLMinutes - 3;
let minuteUpdates = []; // array of urls to update every one minute
const maxMinuteUpdates = 100; // prevent ddos attacks

// ensure suitable ranges for the TTL Minute variables
if (defaultTTLMinutes < 3) defaultTTLMinutes = 3;
if (refreshTTLMinutes >= defaultTTLMinutes) refreshTTLMinutes = defaultTTLMinutes - 3;
if (refreshTTLMinutes < 0) refreshTTLMinutes = 1;

/*
 * TODO
 *      write a function that gets the tagId for all tags that have post groups on the website so we can look for those ids in the new post page.
 *      Automatically update tag collections if new post contains tags for: earning, etc. (see today page for list of tag slugs to look out for).
 */

require('dotenv').config()
const DOMAIN = process.env.DOMAIN;
const BASE_URL = process.env.BASE_URL;
const REST_URL = process.env.REST_URL;
const SECRET_KEY = process.env.SECRET_KEY;
const HTTP_PORT = 5001;
const HTTPS_PORT = 5000;

// import required packages
const serializerr = require('serializerr');
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { application } = require('express');
const axios = require('axios');
const lodash = require('lodash');

// express server
const app = express();

// redis
const redisPackage = require('redis');
const { serialize } = require('v8');
const redis = redisPackage.createClient();
redis.on('connect', async () => {
    console.log('redis connected!');
});
redis.connect();

const displayError = err => console.error(serializerr(err));

//monitor urls being requested
// app.use((req, res, next) => {
//     console.log(req.url);
//     next();
// });

app.use(express.json({limit: '200mb'}));
app.use(cors());

const isAlphanumeric = str => {
    if (str.match(/^[0-9a-z]+$/i)) return true;
    return false;
}

app.get('/reset-post-keys', (req, res) => {
    let { key } = req.query;

    if (!key) key = 'empty';

    res.status(200).send(key);
});


const sanitizeString = str => {
    return encodeURIComponent(str);
}

const updateKey = (url, key = null) => {
    if (!key) key = `url:${url}`;

    const request = {
        url: url.indexOf('?') !== -1 ? `${url}&cache=skip` : `${url}?cache=skip`,
        method: 'get'
    }

    axios(request)
    .then(response => {
        redis.set(key, response.data, {EX: defaultTTLMinutes * 60});
    })
    .catch(err => console.error(err));
}

setInterval(() => {
    for (let i = 0; i < minuteUpdates.length; ++i) updateKey(minuteUpdates[i]);
}, 60000);

const cacheUrl = async (req, res) => {
    const { preview, update, url, ttl } = req.query;
    if (!url) return;

    if (ttl) minuteUpdates = minuteUpdates.filter(link => link !== url);

    if (update) {
        let test = minuteUpdates.find(link => link === url);
        if (!test && minuteUpdates.length < maxMinuteUpdates) minuteUpdates.push(url);
    }

    if (ttl || update) console.log(minuteUpdates);

    let key = '';
    let gotContent = false;
    
    key = `url:${url}`;
    const result = await redis.get(key);
    if (result) {
        console.log(`Got key: ${key}`);
        gotContent = true;
        res.status(200).send(result);
    }    
    
    if (!gotContent) res.status(200).send('no');
    else {
        let timeRemaining = await redis.ttl(key);
        if (timeRemaining && timeRemaining > (refreshTTLMinutes * 60) && !preview) return;
    }

    if (key) updateKey(url, key);
}


const generateRestKey = (baseKey, req) => {
    let key = baseKey;

    const urlParams = Object.keys(req.params);
    for (let i = 0; i < urlParams.length; ++i) key += `::${sanitizeString(urlParams[i])}:${sanitizeString(req.params[urlParams[i]])}`;

    const queryParams = Object.keys(req.query);
    for (let i = 0; i < queryParams.length; ++i) key += `::${sanitizeString(queryParams[i])}:${sanitizeString(req.query[queryParams[i]])}`;


    return key
}


/*
 * processRequest
 *      if res is provided: sends cached value if exists. Otherwise executes request and sets associated key value.
 *      if res is null: executes request and updates the associated key in the cache.
 */

const processRequest = async (endpoint, baseKey, req, res = null) => {
    let key = generateRestKey(baseKey, req);

    //console.log('processRequest', endpoint, key);

    // check if key is in redis. If so send the JSON parsed result and we are done.
    if (res) {
        const redisVal = await redis.get(key);
        if (redisVal) return res.status(200).send(redisVal);
    }

    const urlParams = Object.keys(req.params);
    const queryParams = Object.keys(req.query);
    
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

    axios(request)
    .then(response => {
        let { data } = response;

        // strip content and other fields from bulk posts to save space in the redis cache
        if (baseKey === 'posts') {
            data = data.map(post => {
                let info = {};
                info.id = post.id;
                info.date_gmt = post.date_gmt;
                info.modified_gmt = post.modified_gmt;
                info.slug = post.slug;
                info.status = post.status;
                info.link = post.link;
                info.title = { rendered: post.title.rendered};
                info.excerpt = { rendered: post.excerpt.rendered};
                info.author = post.author;
                info.featured_media = post.featured_media;
                info.categories = post.categories;
                info.tags = post.tags;  
                info._links = lodash.cloneDeep(post._links);
                return info;
           });
        }

        const stringData = JSON.stringify(data);
        redis.set(key, stringData);
        if (res) res.status(200).send(stringData);

    })
    .catch(err => {
        console.error(serializerr(err));
        if (res) res.status(400).send('invalid request');
    });
}

const handleGet = (endpoint, baseKey, req, res) => {
    processRequest(endpoint, baseKey, req, res);
}

// Use cache to generate full page of posts if such info is in cache

let PageOfPostsMaxCurPage = 1;

const getPageOfPosts = async (endpoint, baseKey, req, res) => {
    let request = {
        query: {
            type: 'posts',
            per_page: req.params.numPerPage,
            page: req.params.curPage
        },
        params: {}
    }

    let testKey = generateRestKey('posts', request);
    let posts = await redis.get(testKey);
    if (!posts) return res.status(400).json(false);
    posts = JSON.parse(posts);

    let url = '';
    let loc = -1;
    let id = '';
    let mediaUrl = '';

    for (let i = 0; i < posts.length; ++i) {
        // see if the media information is already in the cache
        url = posts[i]._links['wp:featuredmedia'][0].href;
        url = url.replace('https://www.pymnts.com', BASE_URL);
        loc = url.lastIndexOf('/');
        id = url.substring(loc+1);

        request = {
            query: {},
            params: {
                id 
            }
        }

        testKey = generateRestKey('mediaId', request);
        mediaInfo = await redis.get(testKey);

        // if media info is not in the cache return status 400
        if (!mediaInfo) return res.status(400).json(false);
        mediaInfo = JSON.parse(mediaInfo);
        
        // if media info is in cache, add it to the posts array
        posts[i].mediaInfo = mediaInfo;

        if (posts[i].categories.length) {
            id = posts[i].categories[0];

            request = {
                query: {},
                params: {
                    id 
                }
            }
    
            testKey = generateRestKey('categoriesId', request);
            categoryInfo = await redis.get(testKey);
            
            if (!categoryInfo) return res.status(400).json(false);
            categoryInfo = JSON.parse(categoryInfo);

            posts[i].categoryInfo = categoryInfo;

        } else {
            posts[i].categoryName = '';
        }
    }

    //redis.set(key, JSON.stringify(posts));
    res.status(200).send(posts);
}

const LatestPost = {
    id: 0,
    date_gmt: '',
    modified_gmt: ''
}

const handleNewPosts = async () => {
   // check for new posts
   let request = {
        url: `${REST_URL}/wp-json/wp/v2/posts/?type=posts&per_page=100`,
        method: 'get'
   }
   let response;
   
   try {
        response = await axios(request);
   }    
   catch(err) {
        displayError(err);
        return;
   }

   const { data } = response;

   const { id, date_gmt, modified_gmt, featured_media, categories, tags } = data[0];

   if (id === LatestPost.id && modified_gmt === LatestPost.modified_gmt) return;

   LatestPost.id = id;
   LatestPost.modified_gmt = modified_gmt;
   LatestPost.date_gmt = date_gmt;

   //console.log('New Post!', id, date_gmt, modified_gmt, featured_media, categories, tags);

   let key, result, categoryId;

   // add any missing mediaId and categoryId key/value pairs to the cache
   for (let i = 0; i < data.length; ++i) {
        const { featured_media, categories } = data[i];

        if (featured_media) {
            key = `mediaId::id:${featured_media}`;
            result = await redis.get(key);

            if (!result) {
                request = {
                    query: {},
                    params: {
                        id: featured_media 
                    }
                }
                processRequest('/wp-json/wp/v2/media/:id', 'mediaId', request);
            }
        }

        if (categories && categories.length) {
            categoryId = categories[0];
            
            key = `categoriesId::id:${categoryId}`;
            result = await redis.get(key);

            if (!result) {
                request = {
                    query: {},
                    params: {
                        id: categoryId 
                    }
                }
                processRequest('/wp-json/wp/v2/categories/:id', 'categoriesId', request);
            }
        }
   }

   // 10 seconds later, update the first five pages of posts

   setTimeout(() => {
        for (let i = 1; i <= 5; ++i) {
            request = {
                query: {
                    type: 'posts',
                    per_page: 21,
                    page: i
                },
                params: {}
            }
            processRequest('/wp-json/wp/v2/posts', 'posts', request);
        }
   }, 10000);

   // 30 seconds later, delete pageOfPosts key

   
}

// Generic WP REST API endpoints

app.get('/wp-json/wp/v2/posts/:id',  (req, res) => handleGet('/wp-json/wp/v2/posts/:id', 'postsId', req, res));
app.get('/wp-json/wp/v2/posts',  (req, res) => {
    console.log(req.url, req.query, req.params);
    handleGet ('/wp-json/wp/v2/posts', 'posts', req, res)
});

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

app.get('/wp-json/wp/v2/users/:id',  (req, res) => handleGet('/wp-json/wp/v2/users/:id', 'usersId', req, res));
app.get('/wp-json/wp/v2/users/',  (req, res) => handleGet('/wp-json/wp/v2/users/', 'users', req, res));

app.get('/wp-json/wp/v2/search/',  (req, res) => handleGet('/wp-json/wp/v2/search/', 'search', req, res));

// Custom REST endpoints

app.get('/wp-json/wp/v2/custom/page-of-posts/:curPage/:numPerPage', (req, res) => getPageOfPosts('/wp-json/wp/v2/custom/page-of-posts/:curPage/:numPerPage', 'pageOfPosts', req, res));



// NEVER use this command in production. For development ONLY.
const deleteRedisKeys = async prefix => {
    const keys = await redis.keys(prefix + '*');
    for (let i = 0; i < keys.length; ++i) {
        redis.del(keys[i]);
    }
}

app.get('/url-cache', (req, res) => cacheUrl(req, res));

// app.get('/new-post/:id', (req, res) => handleNewPost(req, res));


// server listening

const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP listening on port ${HTTP_PORT}`);
})


const httpsServer = https.createServer({
    key: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/privkey.pem`),
    cert: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`),
  }, app);
  
  
  httpsServer.listen(HTTPS_PORT, () => {
      console.log(`HTTPS Server running on port ${HTTPS_PORT}`);
      //setInterval(handleNewPosts, 60000);
  });

// let request = {
//     url: "https://dev.pymnts.com",
//     method: 'get'
// }
// axios(request)
// .then(response => console.log(response.data))
// .catch(err => console.error(err));