export function uncurryThis<T, A extends any[], R>(func: (this: T, ...args: A) => R) {
    return (thisArg: T, ...args: A) => Reflect.apply(func, thisArg, args) as R;
}

export const stringifyFunction: (fn: Function) => string = uncurryThis(Function.prototype.toString);
