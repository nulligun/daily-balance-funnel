/**
 * Sets delay for given amount of time.
 *
 * @param {number} t
 * @returns {Promise<any>}
 */
export function setDelay(t: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, t);
    });
}

interface Array<T> {
    flatMap<E>(callback: (t: T) => Array<E>): Array<E>
}

Object.defineProperty(Array.prototype, "flatMap", {
    value: function(f: Function) {
        return this.reduce((ys: any, x: any) => {
            return ys.concat(f.call(this, x))
        }, [])
    },
    enumerable: false,
})