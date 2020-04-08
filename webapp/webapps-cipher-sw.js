/**
 * The service worker will cache resources to allow offline usage :
 * - GOOGLE : https://developers.google.com/web/fundamentals/primers/service-workers/#update-a-service-worker
 * - MOZILLA : https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
 */
var cacheName = 'v1';
var baseCacheContent = [
	'./libs/bootstrap/css/bootstrap.min.css',
	'./libs/bootstrap/js/bootstrap.min.js',
	'./libs/forge/forge-custom-cipher.min.js',
	'./libs/jquery/jquery.min.js',
	'./libs/material-icons/clear.svg',
	'./libs/material-icons/files.svg',
	'./libs/material-icons/launch.svg',
	'./libs/popper/popper.min.js',
	'webapps-cipher.css',
	'webapps-cipher.js',
	'webapps-cipher.html',
	'webapps-cipher.ico',
	'webapps-cipher.png'
];

function info(text) {
	console.log('Service Worker : ' + text);
}

function trace(text) {
	// console.log('Service Worker : ' + text);
}

self.addEventListener('install', function(event) {
	info('installed');
	self.skipWaiting();
	event.waitUntil(caches.open(cacheName).then(function(cache) {
		info('caching data');
		return cache.addAll(baseCacheContent).then(function() {
			info('data cached');
		});
	}))
});

self.addEventListener('activate', function(event) {
	info('activated');
	event.waitUntil(caches.keys().then(function(keys) {
		var cacheWhitelist = [cacheName];
		return Promise.all(keys.map(function(key) {
			if (cacheWhitelist.indexOf(key) === -1) {
				info('cleaning old cache ' + key);
				return caches.delete(key);
			}
		})).then(function() {
			return clients.claim();
		});
	}));
});

self.addEventListener('fetch', function(event) {
	event.respondWith(caches.match(event.request).then(function(response) {
		if (response) {
			trace('using cache for ' + event.request.url);
			return response;
		}
		trace('fetching data for ' + event.request.url);
		return fetch(event.request).then(function(response) {
			if (!response || response.status !== 200 || response.type !== 'basic')
				return response;
			// Clone the response : one to return, one for cache
			var responseToCache = response.clone();
			caches.open(cacheName).then(function(cache) {
				trace('caching response for ' + event.request.url);
				cache.put(event.request, responseToCache);
			});
			return response;
		});
	}));
});
