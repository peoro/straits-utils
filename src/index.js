
const assert = require('assert');

class TraitSet {
	static fromKeys( obj ) {
		return TraitSet.fromStrings( Object.keys(obj) );
	}
	static fromStrings( names ) {
		const obj = {};
		names.forEach( name=>{ obj[name] = Symbol(name); } );
		return new TraitSet(obj);
	}

	constructor( traitSet={} ) {
		for( let key in traitSet ) {
			const sym = traitSet[key];
			if( typeof sym === 'symbol' ) {
				this[key] = sym;
			}
		}
	}

	// the following will be implemented later, as an alias for `Object.prototype.*traitsToFreeFunctions`
	//asFreeFunctions() {}
}

const traits = TraitSet.fromStrings([
	// traits for `Symbol` to aid its usage as traits
	`impl`,	// sym( target, implementation ) => this
	`implDefault`,	// sym( implementation ) => this
	`asFreeFunction`,	// sym() => {fn}

	// traits for `Object` to aid its usage as trait sets
	// stuff to add new traits to `this`
	`addSymbol`,	// obj( name, sym ) => symbol
	`defineTrait`,	// obj( name ) => symbol
	`borrowTraits`,	// obj( traitSet, names=undefined ) => this
	// stuff to create wrappers for traits from `this`
	`traitsToFreeFunctions`,	// obj() => {fn}
	// stuff to implement many traits at once (and maybe define them too)
	`implTraits`,	// obj( target, implementationObj ) => this
	`defineAndImplTraits`,	// obj( target, implementationObj ) => this
	`defineAndImplMethodsAsTraits`,	// obj( target, source, methodList ) => this
	`defineAndImplMemberFreeFunctionsAsTraits`,	// obj( target, functionObj ) => this
]);

use traits * from traits;

// we'll use `Symbol['@straits']` to store everything we want to be globally available
// i.e. available to other packages we might be unaware of (including different versions of `@straits/utils`)
const namespace = (()=>{
	if( Symbol['@straits'] ) {
		return Symbol['@straits'];
	}

	return Symbol['@straits'] = {
		defaultImpls: new Map() // NOTE: a WeakMap would be better here, but: https://github.com/tc39/ecma262/issues/1194
	};
})();

TraitSet.namespace = namespace;

// implementing traits for traits for `Symbol`
{
	// set `target[ this ]` to `implementation`
	Symbol.prototype.*impl = function( target, implementation ) {
		Object.defineProperty( target, this, {value:implementation, configurable:true} );
		return this;
	};
	// set `implementation` as the default implementation for `this` trait
	// it will be used if `this` trait is called (as a method or free function) on something that doesn't  implement `this` trait
	Symbol.prototype.*implDefault = function( implementation ) {
		namespace.defaultImpls.set( this, implementation );
		return this;
	};

	// create and return a free function wrapping `this`
	Symbol.prototype.*asFreeFunction = function() {
		const symName = String(this).slice(7, -1);
		const sym = this;

		return function( target, ...args ) {
			if( target === undefined || target === null ) {
				const {defaultImpls} = namespace;
				if( defaultImpls.has(sym) ) {
					return defaultImpls.get(sym)( target, ...args );
				}
				throw new Error(`.*${symName} called on ${target}`);
			}

			if( ! target[sym] ) {
				const {defaultImpls} = namespace;
				if( defaultImpls.has(sym) ) {
					return defaultImpls.get(sym)( target, ...args );
				}
				throw new Error(`.*${symName} called on ${target} that doesn't implement it.`);
			}

			return target[sym]( ...args );
		};
	};
}

// implementing traits for trait sets on `Object`
{
	// add `symbol` to `this` with key `name`
	Object.prototype.*addSymbol = function( name, sym ) {
		assert( ! this.hasOwnProperty(name), `Trying to re-define trait \`${name}\`` );
		assert.equal( typeof sym, `symbol`, `Trying to add \`${name}\`, but it's not a symbol` );
		return this[name] = sym;
	};
	// add a new trait called `name` to `this`
	Object.prototype.*defineTrait = function( name ) {
		return this.*addSymbol( name, Symbol(name) );
	};
	// add to `this` trait set all the symbols from `traitSet` specified by `names`
	Object.prototype.*borrowTraits = function( traitSet, names ) {
		if( ! names ) {
			for( let key in traitSet ) {
				const sym = traitSet[key];
				if( typeof sym === 'symbol' ) {
					this.*addSymbol( key, sym );
				}
			}

			return this;
		}

		names.forEach( name=>{
			this.*addSymbol( name, traitSet[name] );
		});
		return this;
	};

	// `this` is treated as a trait set: return a free function wrapping each trait
	Object.prototype.*traitsToFreeFunctions = function() {
		const result = {};

		for( let key in this ) {
			const sym = this[key];
			if( typeof sym === 'symbol' ) {
				result[key] = sym.*asFreeFunction();
			}
		}

		return result;
	};

	// `implementationObj` is an object whose keys are names of traits in `this` trait set
	// for each `key, value` entry of `implementationObj`, set `target[ this[key] ]` to `value`
	Object.prototype.*implTraits = function( target, implementationObj ) {
		for( let name in implementationObj ) {
			const sym = this[name];
			assert( typeof sym === 'symbol', `No trait \`${name}\`` );

			sym.*impl( target, implementationObj[name] );
		}
		return this;
	};
	// for each `key, value` entry of `implementationObj`,
	// create a new symbol called `key` in `this` trait set, and set `target[ this[key] ]` to `value`
	Object.prototype.*defineAndImplTraits = function( target, implementationObj ) {
		for( let name in implementationObj ) {
			const value = implementationObj[name];
			this.*defineTrait( name ).*impl( target, value );
		}
		return this;
	};
	// `methodList` is a list of method names in `source`
	// for each method name `m` in `methodList`, create a new trait in `this` trait set,
	// and set `target[ this[m] ]` to a function wrapping `::source.m()`
	Object.prototype.*defineAndImplMethodsAsTraits = function( target, source, methodList ) {
		methodList.forEach( (methodName)=>{
			this
				.*defineTrait( methodName )
				.*impl( target, ({[methodName](){
					return source[methodName]( this, ...arguments );
				}})[methodName] );
		});
		return this;
	};
	// `functionObj` is an object whose values are free functions
	// for each `key, value` entry in `methodList`, create a new trait in `this` trait set,
	// and set `target[ this[key] ]` to a function wrapping `::source.m()`
	Object.prototype.*defineAndImplMemberFreeFunctionsAsTraits = function( target, functionObj ) {
		for( let fnName in functionObj ) {
			const fn = functionObj[fnName];
			if( typeof fn !== 'function' ) {
				continue;
			}

			this
				.*defineTrait( fnName )
				.*impl( target, ({[fnName](){
					return fn( this, ...arguments );
				}})[fnName] );
		}
		return this;
	};
}

// finalizing and exporting
{
	// adding missing methods to TraitSet's prototype
	TraitSet.prototype.asFreeFunctions = Object.prototype.*traitsToFreeFunctions;

	// adding our traits to `TraitSet`
	TraitSet.*borrowTraits( traits );

	// adding functions to convert TraitSet's traits into free functions and methods
	TraitSet.prototype.asFreeFunctions = Object.prototype.*traitsToFreeFunctions;

	// exporting TraitSet
	module.exports.TraitSet = TraitSet;
}
