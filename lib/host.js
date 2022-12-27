class Host {
    constructor(hostObject) {

        for (const [key, value] of Object.entries(hostObject)) {
            this[key] = value;
        }

        this.retry = false;

        this.dead = false;
        this.deadSince = 0;

    }
    toJSON() {
        return this
    }
    markDead() {
        this.dead = true;
        this.retry = false;
        this.deadSince = Date.now();
    }
    clearDead() {
        this.dead = false;
        this.retry = false;
        this.deadSince = 0;
    }

    tryAgain() {
        const tryAgain = Date.now() - this.deadSince > 60000;

        if (tryAgain) {

            if (!this.retry) {
                this.retry = true;
                return true
            }
        }

        return false
    }

}

module.exports = Host