// IMPORTANT: check custom ttl first, if not present use default ttl
const defaultTTL = 86400;
const customTTL = [];
const addCustomTTL = (route, ttl) => customTTL.push({route, ttl});
addCustomTTL('/topic', 30000);
addCustomTTL('/category', 30000);
addCustomTTL('/tag', 30000);
addCustomTTL('/b2b', 30000);


/*
 * TODO
 *      write a function that gets the tagId for all tags that have post groups on the website so we can look for those ids in the new post page.
 *      Automatically update tag collections if new post contains tags for: earning, etc. (see today page for list of tag slugs to look out for).
 */

const DOMAIN = "api.appgalleria.com";
const BASE_URL = "https://api.appgalleria.com";
const REST_URL = "https://pymnts.com";
const SECRET_KEY = 'ksdndkklw4890dfio409dfjoe0509e5oifdhrehhioers';
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

const redisPackage = require('redis');
const { serialize } = require('v8');
const redis = redisPackage.createClient();
redis.on('connect', async () => {
    console.log('redis connected!');
});
redis.connect();

const displayError = err => console.error(serializerr(err));

// create new express app and save it as "app"
const app = express();

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

const generateUrlKey = path => `url:${path}`;

const getTTL = path => {
    let ttl = defaultTTL;

    for (let i = 0; i < customTTL.length; ++i) {
        if (path.startsWith(customTTL[i].route)) {
            ttl = customTTL[i].ttl;
            break;
        } 
    }

    return ttl;
}

const updateUrlKey = (path, key = '', ttl = null) => {
    if (!ttl) ttl = getTTL(path);
    if (!key) key = generateUrlKey(path);

    const request = {
        url: path.indexOf('?') !== -1 ? `https://www.pymnts.com${path}&preview=true` : `https://www.pymnts.com${path}?preview=true`,
        method: 'get'
    };

    axios(request)
    .then(response => {
        console.log(`set key: ${key}`);
        redis.set(key, response.data, {EX: ttl});
    })
    .catch(err => {
        // perhaps set key to error message here and check send no when result exists but se
    })
}

const cacheUrl = async (req, res) => {
    const path = req.url.substring(10);
    const ttl = getTTL(path);
    let key = generateUrlKey(path);
    
    const result = await redis.get(key);

    if (result) {
        console.log(`Got key: ${key}`);
        return res.status(200).send(result);
    }
    res.status(200).send('no');

    updateUrlKey(path, key, ttl);
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
                //console.log(post._links);       
                info._links = lodash.cloneDeep(post._links);
                //console.log('info._links', info._links);
                return info;
           });
        }

        const stringData = JSON.stringify(data);
        redis.set(key, stringData);
        //console.log(`successfully updated ${key}`);
        //redis.rPush(`list:${baseKey}`, key);
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

   // Update UrlKeys
   // If we are here, we have at least one new post
 
    updateUrlKey('/');
    updateUrlKey('/today-on-pymnts');
    
   // Three things update for url cache
        // rekey the post itself if the modified time is different
        // cycle through tags and update topics page and other tag driven pages
            // investigate the topics 
            // For now any key starting with /topic will be cached for 30 minutes until we can determine a realtime trigger
            // realtime update /tag/tagName /topic/tagName /category/tagName
            // /sitemap.xml 10 minute caching
                // anything route starting with /sitemap 10 minute cache

   
   LatestPost.id = id;
   LatestPost.modified_gmt = modified_gmt;
   LatestPost.date_gmt = date_gmt;

   console.log('New Post!', id, date_gmt, modified_gmt, featured_media, categories, tags);


   let key, result, categoryId;

   // add any missing mediaId and categoryId key/value pairs to the cache
   for (let i = 0; i < data.length; ++i) {
        const { featured_media, categories } = data[i];

        if (featured_media) {
            key = `mediaId::id:${featured_media}`;
            result = await redis.get(key);
            //result ? console.log(`mediaId ${featured_media} success`) : console.log(`mediaId ${featured_media} failure`);

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
            //result ? console.log(`categoryId ${categoryId} success`) : console.log(`categoryId ${categoryId} failure`);

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


// IMPORTANT: TRY THIS for unlimited folders: https://stackoverflow.com/questions/6161567/express-js-wildcard-routing-to-cover-everything-under-and-including-a-path

app.get('/url-cache(/*)?', (req, res) => cacheUrl(req, res));

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
      setInterval(handleNewPosts, 30000);
  });
