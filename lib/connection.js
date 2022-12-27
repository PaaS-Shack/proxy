const events = require('events');
const { v1: uuid } = require('uuid');


const Timer = require('./timer');


class Connection extends events.EventEmitter {
    constructor(connection) {
        super();

        this.connection = connection;

        this.timer = new Timer('Connection');

        this.requests = new Map();

        this.timer.trigger('start');

        this.id = connection.id = uuid();

        this.remoteAddr = this.getRemoteAddress();
        this.remotePort = connection.remotePort;

        this.secure = connection.secure

        this.attachEvents();
    }
    encrypted() {
        return this.connection.encrypted
    }
    getRemoteAddress() {
        let remoteAddr = null;

        const connection = this.connection;

        if (connection.remoteAddress)
            remoteAddr = connection.remoteAddress;
        else if (connection.socket && connection.socket.remoteAddress)
            remoteAddr = connection.socket.remoteAddress;
        else if (remoteAddr == null)
            return remoteAddr;

        return remoteAddr.replace(/^::ffff:/, '');
    }
    setKeepAlive(httpKeepAlive) {
        this.connection.setKeepAlive(httpKeepAlive);
    }
    setTimeout(tcpTimeout) {
        this.connection.setTimeout(tcpTimeout);
    }
    attachEvents() {
        const connection = this.connection;


        connection.once('error', (error) => {
            this.timer.trigger('error');
            this.emit('error', error)
        });
        connection.once('timeout', () => {
            this.timer.trigger('timeout');
            connection.destroy();
        });

        connection.once('close', () => {
            this.timer.trigger('close');
            this.emit('close')
        });
        connection.once('end', () => {
            this.timer.trigger('end');
            connection.destroy();
        });
    }

    addRequest(request) {

        this.timer.trigger('request')
        this.requests.set(request.id, request);
        request.once('close', () => {
            this.requests.delete(request.id);
        })

    }
}
module.exports = Connection