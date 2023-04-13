"use strict";

const { MoleculerClientError, MoleculerRetryableError } = require("moleculer").Errors;

const LRU = require("lru-cache")

const fs = require('fs');

const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');

const isIp = require('is-ip');
const tls = require("tls");


const Connection = require("../lib/connection");
const Request = require("../lib/request");
const Route = require("../lib/route");
const Queue = require("../lib/queue");
const Tracker = require("../lib/tracker");

const morgan = require('morgan')

morgan.token('remote-addr', function (req) {
    return req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
});


const RoundRobinStrategy = require('../lib/strategies/round-robin')
const RandomStrategy = require('../lib/strategies/random')
const LatencyStrategy = require('../lib/strategies/latency')
const IPHashStrategy = require('../lib/strategies/ip-hash')


module.exports = {
    name: "proxy.agent",
    version: 1,
    //mixins: [DbService("routes.balancer")],

    /**
     * Default settings
     */
    settings: {
        clusterName: process.env.CLUSTER_NAME || 'default',
        logger: morgan('combined'),
        httpKeepAlive: false,
        maxSockets: 1000,
        port: 80,
        https: { port: 443 },

        tcpTimeout: 500,
        retryOnError: 3,
        errorPage: fs.readFileSync(__dirname + '/../static/error_default.html')
    },

    /**
     * Dependencies
     */
    dependencies: [
        "v1.routes"
    ],
    /**
     * Actions
     */
    actions: {

        createRoute: {
            params: {
                vHost: { type: "string", min: 2, optional: false },
                strategy: { type: "string", min: 2, optional: false },

                auth: { type: "string", min: 2, optional: true },
            },
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);
                const { vHost } = Object.assign({}, ctx.params);

                let route = this.routes.get(vHost);

                if (!route) {
                    route = await this.createNewRoute(params, ctx);
                }

                return route
            }
        },
        addHost: {
            params: {
                vHost: { type: "string", min: 2, optional: false },
                id: { type: "string", min: 2, optional: false },
                hostname: { type: "string", min: 2, optional: false },
                port: { type: "number", optional: false },
            },
            async handler(ctx) {
                const host = Object.assign({}, ctx.params);
                const { vHost } = host;

                let route = this.routes.get(vHost);

                if (route) {
                    route.addHost(host)
                }
                return route.toJSON()
            }
        },
        removeHost: {
            params: {
                vHost: { type: "string", min: 2, optional: false },
                id: { type: "string", min: 2, optional: false },
            },
            async handler(ctx) {
                const host = Object.assign({}, ctx.params);
                const { vHost, id } = host;

                let route = this.routes.get(vHost);

                if (route) {
                    route.removeHost(id);
                }
                return route
            }
        },
        markHostDead: {
            params: {
                vHost: { type: "string", min: 2, optional: false },
                host: { type: "string", min: 2, optional: false },
            },
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);

                const route = await this.getRoute(params.vHost);
                if (!route)
                    throw new MoleculerClientError(`No route. (${params.vHost})`, 400, "ERR_EMAIL_EXISTS");

                const host = route.hosts.get(params.host);

                if (!host)
                    throw new MoleculerClientError(`No host. (${params.host})`, 400, "ERR_EMAIL_EXISTS");

                route.markHostDead(host, false);
            }
        },
        resolve: {
            params: {
                size: { type: "string", min: 2, optional: false },
            },
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);

                let stack = await this.adapter.findOne({ name: params.size });
                if (!stack)
                    stack = await this.adapter.findById(params.size);

                if (!stack)
                    throw new MoleculerClientError("size not found.", 400, "ERR_EMAIL_EXISTS");

                return stack
            }
        },
        stats: {
            params: {
                vHost: { type: "string", min: 3, lowercase: true, optional: true },
            },
            async handler(ctx) {
                const { vHost } = Object.assign({}, ctx.params);
                return this.tracker.toJSON(vHost)
            }
        },
        info: {
            params: {
                vHost: { type: "string", min: 3, lowercase: true, optional: true },
            },
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);
                const result = {};
                if (params.vHost) {
                    const route = this.routes.get(params.vHost);
                    if (route) {
                        result[params.vHost] = route.toJSON();
                    }
                } else {
                    for (var [key, value] of this.routes.entries()) {
                        result[key] = value.toJSON();
                    }
                }

                return result;
            }
        },

        sync: {
            params: {

            },
            async handler(ctx) {
                const routes = await ctx.call('v1.routes.find', {
                    query: { deletedAt: null },
                    populate: 'hosts',
                    scope: false
                })

                this.log(`Syncing ${routes.length} routes`)

                this.routes = new Map();
                const promises = [];

                for (let index = 0; index < routes.length; index++) {
                    const route = routes[index];

                    promises.push(this.actions.syncRoute(route, { parentCtx: ctx }));
                }
                return Promise.allSettled(promises)
            }
        },
        syncRoute: {
            params: {

            },
            async handler(ctx) {
                const route = ctx.params;
                const promises = [];

                this.actions.createRoute({
                    ...route
                }, { parentCtx: ctx })
                    .then(() => ctx.call('v1.routes.hosts.find', {
                        route: route.id,

                        query: { route: route.id, deletedAt: null },
                        scope: false
                    })).then((hosts) => {
                        const promises = [];
                        for (let index = 0; index < hosts.length; index++) {
                            const target = hosts[index];
                            promises.push(this.actions.addHost({
                                vHost: route.vHost,
                                ...target
                            }, { parentCtx: ctx }));
                        }
                        return Promise.allSettled(promises)
                    });
                return Promise.allSettled(promises)
            }
        },
        logging: {
            params: {
                enable: { type: "boolean", default: true, optional: true }
            },
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);
                this.logger.enable = params.enable;
                return this.logger.enable
            }
        },
    },

    /**
     * Methods
     */
    methods: {
        log(...args) {
            if (this.logger.enable)
                this.logger.info.call(this.logger, ...args)
        },
        async createNewRoute(params, ctx) {

            const { vHost, strategy, auth, headers } = params

            const route = new Route(this.broker, this, vHost);

            this.setRouteStrategy(route, strategy)

            if (auth) {
                route.setAuth(auth)
            }

            route.setHeaders(headers)

            this.routes.set(vHost, route);

            const certs = await ctx.call('v1.certificates.resolveDomain', { domain: vHost, environment: 'production' }).catch(() => null);
            if (certs) {
                route.setSecureContext(tls.createSecureContext({
                    key: certs.privkey,
                    cert: certs.cert,
                }));
                route.setAutoHTTPS(params.certs)
            }

            this.log(`Route created ${vHost} ${strategy} ${auth ? auth : ''}`)


            return route
        },
        setRouteStrategy(route, strategy) {
            switch (strategy) {
                case 'RandomStrategy':
                    route.setStrategy(new RandomStrategy(route, this));
                    break;
                case 'IPHashStrategy':
                    route.setStrategy(new IPHashStrategy(route, this));
                    break;
                case 'LatencyStrategy':
                    route.setStrategy(new LatencyStrategy(route, this));
                    break;
                case 'RoundRobinStrategy':
                    route.setStrategy(new RoundRobinStrategy(route, this));
                default:
                    break;
            }
        },

        setupHTTPProxy() {

            let options = {
                proxyTimeout: 1000,
                timeout: 1000

            };
            if (this.settings.httpKeepAlive !== true) {
                options.agent = false;
            }

            this.log(`HTTP proxy server starting`, options)

            this.proxy = httpProxy.createProxyServer(options);
            http.globalAgent.maxSockets = this.settings.maxSockets;
            https.globalAgent.maxSockets = this.settings.maxSockets;

            this.proxy.on('error', this.proxyErrorHandler.bind(this));
            this.proxy.on('start', this.proxyStartHandler.bind(this));
            this.proxy.on('proxyRes', this.proxyResHandler.bind(this));

            this.setupHTTP();
            if (this.settings.https)
                this.setupHTTPs();

        },

        setupHTTPs() {
            const options = {};

            options.key = fs.readFileSync(__dirname + '/../certs/privkey.pem', 'utf8');
            options.cert = fs.readFileSync(__dirname + '/../certs/fullchain.pem', 'utf8');
            options.SNICallback = async (vHost, cb) => {

                const route = await this.getRoute(vHost);

                if (!route) {
                    return cb(new Error(`No route. (${vHost})`));
                }

                if (!route.hasSecureContext()) {
                    this.log(`bad domain. (${vHost})`)
                    return cb(new Error('bad domain'));
                }

                cb(null, route.getSecureContext());
            }

            this.log(`HTTPs server starting`)

            this.httpsServer = https.createServer(options, (req, res) => {
                if (this.settings.logger) {
                    this.settings.logger(req, res, () => {
                        this.httpRequestHandler(req, res)
                    })
                } else {
                    this.httpRequestHandler(req, res)
                }
            });

            this.httpsServer.on('connection', (connection) => {
                connection.secure = true;
                this.tcpConnectionHandler(connection)
            });
            this.httpsServer.on('upgrade', this.wsRequestHandler.bind(this));
            this.httpsServer.listen(this.settings.https.port, () => {
                var host = this.httpsServer.address().address;
                var port = this.httpsServer.address().port;

                this.log(`HTTPs server running at ${host}:${port}`)
            });
        },
        closeHTTP() {
            if (this.httpServer) {
                this.log(`HTTP server closing`)
                this.httpServer.close()
            }
            if (this.httpsServer) {
                this.log(`HTTPs server closing`)
                this.httpsServer.close()
            }
        },
        setupHTTP() {
            this.log(`HTTP server starting`)

            this.httpServer = http.createServer((req, res) => {
                if (this.settings.logger) {
                    this.settings.logger(req, res, () => {
                        this.httpRequestHandler(req, res)
                    })
                } else {
                    this.httpRequestHandler(req, res)
                }
            });
            this.httpServer.on('connection', (connection) => {
                connection.secure = false;
                this.tcpConnectionHandler(connection)
            });
            this.httpServer.on('upgrade', (req, socket, head) => this.wsRequestHandler(req, socket, head));

            this.httpServer.listen(this.settings.port, () => {
                var host = this.httpServer.address().address;
                var port = this.httpServer.address().port;

                this.log(`HTTP server running at ${host}:${port}`)
            });
        },
        enableCors(req, res) {
            if (req.headers['access-control-request-method']) {
                res.setHeader('access-control-allow-methods', req.headers['access-control-request-method']);
            }

            if (req.headers['access-control-request-headers']) {
                res.setHeader('access-control-allow-headers', req.headers['access-control-request-headers']);
            }

            if (req.headers.origin) {
                res.setHeader('access-control-allow-origin', req.headers.origin);
                res.setHeader('access-control-allow-credentials', 'true');
            }
        },
        async httpRequestHandler(req, res) {

            this.log(`new request incoming`)

            const connection = this.getConnection(req);

            if (!connection)
                return Request.errorMessage(req, res, 'Cannot read connection.');

            this.log(`Connection ID:${connection.id}`)

            const request = new Request(req, res, connection);

            this.log(`Request ID:${request.id}`)

            request.once('end', () => {
                this.log(`Request ID:${request.id} ended`)
                this.tracker.trackTarget(request);
            })

            request.timer.trigger('start');

            connection.addRequest(request);

            request.patch();

            if (req.method === 'OPTIONS') {
                this.enableCors(req, res);
                res.writeHead(200);
                res.end();
                return;
            }
            if (!request.vHost) {
                return Request.errorMessage(req, res, 'Cannot read host header.');
            }

            const route = await this.getRoute(request.vHost);

            if (!route)
                return request.errorMessage(`No route. (${request.vHost})`);

            this.log(`Request ID:${request.id} route picked ${route.vHost}`)

            request.setRoute(route);

            if (route.hasSecureContext() && route.autoHTTPS && !connection.secure) {
                this.log(`Request ID:${request.id} redirecting to HTTPs`)
                res.writeHead(302, {
                    location: `https://${request.vHost}${req.url}`,
                });
                res.end();
                return;
            }

            if (route.hasAuth()) {
                var [username, password] = new Buffer((req.headers.authorization || '').split(' ')[1] || '', 'base64').toString().split(':');

                const key = `${route.getAuthCaller()}.${req.headers.authorization}`

                if (!this.authCache.get(key)) {
                    const auth = await this.broker.call(route.getAuthCaller(), {
                        username, password
                    }).catch((err) => {
                        console.log(err)
                        return null
                    })

                    if (auth == null) {
                        this.log(`Request ID:${request.id} User unauthorized`)
                        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="nope"' });
                        res.end('HTTP Error 401 Unauthorized: Access is denied');
                        return;
                    } else {
                        this.log(`Request ID:${request.id} User Authorized`)
                        this.authCache.set(key, auth)
                    }
                }


            }
            route.queueRequest(request, this);
        },
        async makeSelection(request) {
            const route = request.getRoute();
            const { req, res, head } = request;

            this.log(`Request ID:${request.id} Making host selection`)

            const host = await route.select(request);

            if (!host) {
                if (route.hostCount() > 0) {
                    return request.errorMessage(`Backend down. (${request.vHost})`);
                } else {
                    return request.errorMessage(`No host. (${request.vHost})`);
                }
            }

            this.log(`Request ID:${request.id} Host ID:${host.id} was picked`)

            const target = request.setHost(host);

            request.timer.trigger('proxy')

            if (request.isWebsocket) {
                this.log(`Request ID:${request.id} Host ID:${host.id} proxying websocket`)
                this.proxy.ws(req, res, head, {
                    target: target
                });
            } else {
                this.log(`Request ID:${request.id} Host ID:${host.id} proxying http`)
                this.proxy.web(req, res, {
                    target: target,
                    xfwd: false,
                    proxyTimeout: 30000
                });
            }
        },

        async wsRequestHandler(req, socket, head) {
            const connection = this.getConnection(req);

            this.log(`Connection ID:${connection.id} upgrade`)

            if (!connection)
                return socket.end();

            const request = new Request(req, socket, connection);

            this.log(`Request ID:${request.id} Websocket`)

            request.websocket(head);

            request.timer.trigger('start');

            if (!request.vHost) {
                return socket.end();
            }

            connection.addRequest(request);

            //request.patch();

            const route = await this.getRoute(request.vHost);

            if (!route)
                return socket.end();

            request.setRoute(route);

            request.once('end', () => {
                this.log(`Request ID:${request.id} ended`)
                this.tracker.trackTarget(request);
            })

            route.queueRequest(request, this);
        },
        tcpConnectionHandler(conn) {

            const connection = new Connection(conn);

            this.log(`Connection ID:${connection.id} new connection`)

            this.connections.set(connection.id, connection);

            connection.setKeepAlive(this.settings.httpKeepAlive);
            connection.setTimeout(this.settings.tcpTimeout * 1000);

            connection.on('error', (error) => {
                this.log(`Connection ID:${connection.id} ERROR:`, error)
            });
            connection.on('timeout', (error) => {
                this.log(`Connection ID:${connection.id} TIMEOUT`)
            });

            connection.on('close', () => {
                this.log(`Connection ID:${connection.id} Closed ${connection.requests.size}`)
                this.connections.delete(connection.id);
            });
        },
        proxyErrorHandler(err, req, res) {
            const connection = this.getConnection(req);
            const requestID = req.id || res.requestID;

            this.log(`Proxy error ${requestID} code ${err.code}`);

            if (!connection) {
                this.log(`no connection opject`, err, req);
                try { res.end(); } catch (e) { }

                return
            }

            const request = connection.requests.get(requestID)

            if (!request) {
                this.log(`no request opject`, err, req);
                try { res.end(); } catch (e) { }
                return
            }

            const host = request.getHost();
            const route = request.getRoute();

            request.setError(err);

            if (err.code === 'ECONNREFUSED' ||
                err.code === 'ETIMEDOUT' ||
                req.error !== undefined) {
                // This backend is dead
                this.log(req.headers.host + ': backend #' + host.id + ' is dead (' + JSON.stringify(err) +
                    ') while handling request for ' + request.vHost);

                route.markHostDead(host);

                const target = request.getTarget();
                if (target) {
                    target.hasEnded();
                }
                this.tracker.trackTarget(request);

            } else {
                this.log(req.headers.host + ': backend #' + host.id + ' reported an error (' +
                    JSON.stringify(err) + ') while handling request for ' + request.vHost);
            }

            request.retries = request.retries + 1;

            if (!connection.connection || connection.connection.destroyed === true) {
                this.log(req.headers.host + ': Response socket already closed, aborting.');
                try {
                    return request.errorMessage('Cannot retry on error', 502);
                } catch (err) {
                    this.log(req.headers.host + ': Cannot end the request properly (' + err + ').');
                }
            }
            if (request.retries >= this.settings.retryOnError) {
                if (this.settings.retryOnError) {
                    this.log(req.headers.host + ': Retry limit reached (' + this.settings.retryOnError + '), aborting.');
                    return request.errorMessage('Reached max retries limit', 502);
                }
                return request.errorMessage('Retry on error is disabled', 502);
            }
            if (connection)
                this.makeSelection(request)
        },
        proxyResHandler(proxyRes, req, res) {
            const request = this.getRequest(req, res)
            if (!request) {

                this.log(`Proxy responce has no request ${req.id}`)
                try { res.end(); } catch (err) {
                    // console.log(err)
                }
                return;
            }

            this.enableCors(req, res);

            const route = request.getRoute();

            if (route.headers)
                for (let index = 0; index < route.headers.length; index++) {
                    const header = route.headers[index];
                    if (header.type == 'any' || header.type == 'req') {
                        proxyRes.headers[header.key] = header.value
                    }
                }

            request.timer.trigger('proxyRes')

            proxyRes.once('data', () => {
                request.timer.trigger('ttfbo')
                this.log(`Request ID:${request.id} Host ID:${request.host.id} Proxy res first byte`)
            })
            proxyRes.once('close', () => {
                this.log(`Request ID:${request.id} Host ID:${request.host.id} close`)
            })
            proxyRes.once('timeout', () => {
                this.log(`Request ID:${request.id} Host ID:${request.host.id} timeout`)
            })
            proxyRes.once('error', () => {
                this.log(`Request ID:${request.id} Host ID:${request.host.id} error`)
            })

            this.log(`Request ID:${request.id} Host ID:${request.host.id} Modified proxy res`)
        },
        getRequest(req, res) {
            const connection = this.getConnection(req);
            let requestID = req.id;

            if (!requestID) {
                requestID = res.requestID
            }


            if (!connection) {
                return false
            }

            return connection.requests.get(requestID)
        },
        getConnection(req) {
            let connectionID = req.connection.id;
            if (!connectionID)
                connectionID = req.client._parent.id;

            return this.connections.get(connectionID);
        },
        proxyStartHandler(req, res, target) {
            const connection = this.getConnection(req);

            const request = target.request;

            this.log(`Request ID:${request.id} Host ID:${request.host.id} Proxy start event`)


            if (!request.isWebsocket) {
                this.writeDebugHeaders(req, res, connection, request)
            }
        },
        vHostParts(vHost) {
            if (isIp(vHost)) {
                return [vHost, '*']
            }

            var parts = vHost.split('.');
            var result = [parts.join('.')];
            var n;
            // Prevent abusive lookups
            while (parts.length > 6) {
                parts.shift();
            }
            while (parts.length > 1) {
                parts.shift();
                n = parts.join('.');
                result.push('*.' + n);
            }
            result.push('*');

            return result;
        },
        async getRoute(vHost) {
            const route = this.routes.get(vHost);
            if (route) {
                return route;
            }
            const parts = this.vHostParts(vHost);

            for (let index = 0; index < parts.length; index++) {
                const part = parts[index];
                const route = this.routes.get(part);
                if (route) {
                    return route;
                }
            }

            return null;
        },
        writeDebugHeaders(req, res, connection, request) {
            const route = request.getRoute();
            const host = request.getHost();

            // res.setHeader('x-debug-backend-url', req.meta.url);
            if (host) {
                res.setHeader('x-debug-backend-id', host.id);
            }

            res.setHeader('x-debug-vhost', request.vHost);
            res.setHeader('x-proxy-id', request.id);
            res.setHeader('x-connection-id', connection.id);

            if (route.headers && route.headers.length) {
                for (let index = 0; index < route.headers.length; index++) {
                    const header = route.headers[index];
                    if (header.type == 'any' || header.type == 'res') {
                        res.setHeader(header.key, header.value)
                    }
                }
            }
        },

    },
    events: {
        "routes.hosts.update": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);
                console.log("routes.hosts.update", params)
                await this.actions.updateRoute(params, { parentCtx: ctx })
            }
        },
        "routes.hosts.dead": {
            async handler(ctx) {
                const { vHost, host } = Object.assign({}, ctx.params);
                console.log("routes.hosts.dead", vHost, host)

                const route = this.routes.get(vHost);

                //route.markHostDead(host)
            }
        },
        "routes.hosts.removed": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params.data);


                const vHost = await ctx.call('v1.routes.resolve', { id: params.route, scope: false, fields: ['id', 'vHost'] }).then((res) => res.vHost)

                console.log("routes.hosts.remove", params)
                await this.actions.removeHost({ ...params, vHost }, { parentCtx: ctx })
            }
        },
        "routes.hosts.created": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params.data);
                const vHost = await ctx.call('v1.routes.resolve', { id: params.route, fields: ['id', 'vHost'] }).then((res) => res.vHost)
                console.log("routes.hosts.add", params)
                await this.actions.addHost({ ...params, vHost }, { parentCtx: ctx })
            }
        },
        "certificates.update": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params);
                const route = await this.getRoute(params.domain).catch(() => null);
                console.log("certificates.update", params, route)
                if (route) {
                    route.setSecureContext(tls.createSecureContext({
                        key: params.privkey,
                        cert: params.cert,
                    }));
                }
            }
        },
        "certificates.created": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params.data);
                const route = await this.getRoute(params.domain).catch(() => null);
                console.log("certificates.created", params, route)
                if (route) {
                    route.setSecureContext(tls.createSecureContext({
                        key: params.privkey,
                        cert: params.cert,
                    }));
                }
            }
        },
        "routes.created": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params.data);
                console.log("routes.create", params)
                await this.actions.createRoute(params, { parentCtx: ctx })
            }
        },
        "routes.removed": {
            async handler(ctx) {
                const params = Object.assign({}, ctx.params.data);
                console.log("routes.remove", params)
                this.routes.delete(params.vHost);
            }
        }
    },
    async stopped() {
        this.closeHTTP();
        this.tracker.stop();
        clearTimeout(this.timeout)
        clearInterval(this.timeout)
        this.broker.emit('proxys.agent.offline')
    },
    async started() {

        this.connections = new Map()
        this.requests = new Map()
        this.routes = new Map()
        this.hosts = new Map()
        this.queue = new Map()

        this.authCache = new LRU({
            max: 500,
            maxAge: 1000 * 60 * 60
        })

        this.tracker = new Tracker(this.broker, this._logs, this.metrics)

        this.setupHTTPProxy()
        this.timeout = setTimeout(() => this.actions.sync().catch(err => console.log(err)).then(() =>
            this.broker.emit('proxys.agent.online')
        ), 100)
        this.timer = setInterval(() => {
            this.broker.emit('proxys.agent.stats', this.tracker.toJSON())
            this.tracker.reset()
        }, 10 * 1000)
    }
};
