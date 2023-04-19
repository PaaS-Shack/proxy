const events = require('events');
const fs = require('fs');
const { v1: uuid } = require('uuid');


const Timer = require('./timer');
const Target = require('./target');


const errorPage = fs.readFileSync(__dirname + '/../static/error_default.html').toString();

class Stats {
    constructor() {
        this.latency = 0
    }
}

class Request extends events.EventEmitter {
    constructor(req, res, connection) {
        super();

        this.req = req;
        this.res = res;
        this.connection = connection;

        this.route = null;
        this.host = null;

        if (res) {
            this.resWriteHead = res.writeHead;
            this.resEnd = res.end;
        } else {
            this.resWriteHead = () => { };
            this.resEnd = () => { };
        }

        this.id = uuid();
        this.res.requestID = this.id
        this.retries = 0;
        this.statusCode = 502
        this.release = false;
        this.ended = false

        this.isWebsocket = false

        this.err = null;
        this.errTime = 0;

        this.timer = new Timer('Request');

        this.sent = {
            end: false,
            headers: false
        };

        if (req.headers.host)
            this.vHost = req.headers.host.split(':').shift();

        if (req.method)
            this.method = req.method;
        if (req.url)
            this.url = req.url;


        this.attachEvents();
    }
    onEnd() {

        if (this.target) {
            this.target.hasEnded();
            if (this.target._host.dead) {
                // console.log('markHostAlive')
                this.route.markHostAlive(this.target)
            } else if (this.target._host.retry) {
                // console.log('markHostStillDead')
                this.route.markHostStillDead(this.target)
            }
        }
        this.timer.trigger('end')
        this.ended = true;
        this.emit('end');
    }
    websocket(head) {
        this.head = head
        this.isWebsocket = true

    }
    setRoute(route) {
        this.route = route;
    }
    getRoute() {
        return this.route
    }
    getTarget() {
        return this.target
    }
    setHost(host) {
        this.host = host;
        const target = new Target(this.connection, this, host);
        this.target = target;
        this.clearError();
        return target;
    }
    getHost() {
        return this.host
    }
    setError(err) {
        this.err = err;
        this.errTime = Date.now();
    }
    hasError() {
        return this.errTime != 0
    }
    clearError() {
        this.err = null;
        this.errTime = 0;
    }
    getError() {
        return this.err
    }
    getStatusCode() {
        return this.statusCode
    }
    attachEvents() {
        //this.req.once('data', () => {
        //    this.timer.trigger('ttfbi')
        //})
        this.res.once('end', () => {
            // console.log('end');
        })
        this.res.once('close', () => {
            // console.log('close');
            this.emit('close')
        })
        this.res.once('error', (error) => {
            this.setError(error)
            this.onEnd();
            console.log('request error', error);
        })
        this.res.once('timeout', () => {
            // console.log('timeout', this.res);
            this.emit('timeout')
        })
        this.res.setTimeout(30 * 1000)
    }
    hasSent(key) {
        return !!this.sent[key];
    }
    send(key) {
        this.sent[key] = true;
    }
    writeForwardedHeaders() {

        const { connection, req } = this;

        if (req.headers['X-Forwarded-For'] === undefined) {
            req.headers['X-Forwarded-For'] = req.headers['x-forwarded-for'] = connection.remoteAddr;
        }
        if (req.headers['X-Real-IP'] === undefined) {
            req.headers['X-Real-IP'] = req.headers['x-real-ip'] = connection.remoteAddr;
        }
        if (req.headers['X-Forwarded-Protocol'] === undefined) {
            req.headers['X-Forwarded-Protocol'] = req.headers['x-forwarded-protocol'] = connection.secure ? 'https' : 'http';
        }
        if (req.headers['X-Forwarded-Proto'] === undefined) {
            req.headers['X-Forwarded-Proto'] = req.headers['x-forwarded-proto'] = connection.secure ? 'https' : 'http';
        }
        if (req.headers['X-Forwarded-Port'] === undefined) {
            // FIXME: replace by the real port instead of hardcoding it
            req.headers['X-Forwarded-Port'] = req.headers['x-forwarded-port'] = connection.secure ? '443' : '80';
        }

    }
    patch() {

        const { res, resWriteHead, resEnd } = this;


        this.writeForwardedHeaders()
        this.timer.trigger('patch')

        res.writeHead = (...args) => {
            this.statusCode = args[0]
            if (this.hasSent('headers'))
                return;

            this.send('headers')
            this.timer.trigger('writeHead')

            this.emit('headers')

            return resWriteHead.apply(res, args);
        }


        res.end = (...args) => {
            if (this.hasSent('end'))
                return;

            if (!this.hasSent('headers')) {
                //res.writeHead()
            }

            this.send('end')
            this.timer.trigger('resEnd')

            resEnd.apply(res, args);

            this.onEnd();
        }
    }

    errorMessage(message, code = 500) {
		try{
        	Request.errorMessage(this.req, this.res, message, code)
		}catch(err){
			if(this.connection&&this.connection.connection){
				this.connection.connection.close()
			}
			console.log(err)
		}
    }

    static errorMessage(req, res, message = 'Application Not Responding', code = 500) {

        const msg = errorPage.replace('{{CODE}}', code).replace('{{MESSAGE}}', message).replace('{{MESSAGE}}', message)
        //console.log('errorMessage', message)

        const headers = {
            'content-length': msg.length,
            'content-type': 'text/html',
            'cache-control': 'no-cache',
            'pragma': 'no-cache',
            'expires': '-1'
        };
			res.writeHead(code, headers);
			res.write(msg);
			res.end();
    }
}
module.exports = Request
