const events = require('events');


class Target extends events.EventEmitter {
    constructor(connection, request, host) {
        super()
        this.connection = connection;
        this.request = request;
        this._host = host;
        this.host = host.hostname;
        this.port = host.port;
        this.protocol = host.protocol || 'http:';
        this.start = Date.now();
        this.end = 0;
    }
    getHostID() {
        return this._host.id;
    }
    hasEnded() {
        this.end = Date.now();
    }
}
module.exports = Target