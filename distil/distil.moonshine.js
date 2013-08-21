/**
 * @fileOverview The Moonshine Distillery. Converts Lua byte code to JSON.
 * @author <a href="mailto:paul.cuthbertson@gamesys.co.uk">Paul Cuthbertson</a>
 * @copyright Gamesys Ltd 2013
 */


var shine = shine || {};


(function () {


	var LUA_TNIL = 0,
		LUA_TBOOLEAN = 1,
		LUA_TNUMBER = 3,
		LUA_TSTRING = 4;




	function Parser () {
		this._data = null;
		this._pointer = null;
		this._tree = null;
	}




	Parser.prototype.parse = function (filename, config, callback) {
		if (callback === undefined) {
			callback = config;
			config = {};
		}

		this._runConfig = config || {};

		var me = this,
			fs = require('fs');
	
		fs.readFile(filename, 'binary', function (err, data) {
			if (err) throw err;
		
			me._data = '' + data;
			me._pointer = 0;
	
			me._readGlobalHeader();	
			me._tree = me._readChunk();
			
			delete me._runConfig;

			if (callback) callback(me._tree);
		});
	}




	Parser.prototype.getTree = function () {
		return this._tree;
	};




	/* --------------------------------------------------
	 * Parse input file
	 * -------------------------------------------------- */


	Parser.prototype._readGlobalHeader = function () {

		this._config = {
			signature: this._readByte(4),
			version: this._readByte().toString(16).split('', 2).join('.'),
			formatVersion: this._readByte(),
			endianess: this._readByte(),

			sizes: {
				int: this._readByte(),
				size_t: this._readByte(),
				instruction: this._readByte(),
				number: this._readByte(),
			},
		
			integral: this._readByte()
		};	
	};




	Parser.prototype._readByte = function (length) {
		if (length === undefined) return this._data.charCodeAt(this._pointer++);
	
		length = length || 1;
		return this._data.substr((this._pointer += length) - length, length);
	};




	Parser.prototype._readString = function () {
	
		var byte = this._readByte(this._config.sizes.size_t),
			length = 0,
			result,
			pos,
			i;

		for (i = this._config.sizes.size_t - 1; i >= 0; i--) length = length * 256 + byte.charCodeAt(i);

		result = length? this._readByte(length) : '',
		pos = result.indexOf(String.fromCharCode(0));

		if (pos >= 0) result = result.substr(0, pos);
		return result;
	};




	Parser.prototype._readInteger = function () {
		var b = this._readByte (this._config.sizes.int),
			bin = '';
	
		for (var i = 0, l = b.length; i < l; i++) bin = ('0' + b.charCodeAt(i).toString(16)).substr(-2) + bin;	// NOTE: Beware of endianess
		return parseInt(bin, 16);
	};




	Parser.prototype._readNumber = function () {

		// Double precision floating-point format
		//	http://en.wikipedia.org/wiki/Double_precision_floating-point_format
		//	http://babbage.cs.qc.edu/IEEE-754/Decimal.html

		var number = this._readByte(this._config.sizes.number),
			data = '';
	
		for (var i = 0, l = number.length; i < l; i++) {
			data = ('0000000' + number.charCodeAt(i).toString(2)).substr(-8) + data;	// Beware: may need to be different for other endianess
		}

		var sign = parseInt(data.substr(-64, 1), 2),
			exponent = parseInt(data.substr(-63, 11), 2),
			mantissa = Parser.binFractionToDec(data.substr(-52, 52), 2);

		if (exponent === 0) return 0;
		if (exponent === 2047) return Infinity;

		return Math.pow(-1, sign) * (1 + mantissa) * Math.pow(2, exponent - 1023);
	};




	Parser.binFractionToDec = function (mantissa) {
		var result = 0;
	
		for (var i = 0, l = mantissa.length; i < l; i++) {
			if (mantissa.substr(i, 1) === '1') result += 1 / Math.pow(2, i + 1);
		}

		return result;
	};




	Parser.prototype._readInstruction = function () {
		return this._readByte(this._config.sizes.instruction);
	};




	Parser.prototype._readConstant = function () {
		var type = this._readByte();

		switch (type) {
			case LUA_TNIL: 		return;
			case LUA_TBOOLEAN: 	return !!this._readByte ();
			case LUA_TNUMBER: 	return this._readNumber ();
			case LUA_TSTRING:	return this._readString ();

			default: throw new Error('Unknown constant type: ' + type);
		}
	};




	Parser.prototype._readInstructionList = function () {
	
		var length = this._readInteger(),
			result = [],
			index;
	
		for (index = 0; index < length; index++) result.push(this._readInstruction ());	
		return result;
	};




	Parser.prototype._readConstantList = function () {
	
		var length = this._readInteger(),
			result = [],
			index;
	
		for (index = 0; index < length; index++) result.push(this._readConstant());

		return result;
	};




	Parser.prototype._readFunctionList = function () {
	
		var length = this._readInteger(),
			result = [],
			index;

		for (index = 0; index < length; index++) result.push(this._readChunk());
		return result;
	};




	Parser.prototype._readStringList = function () {
	
		var length = this._readInteger(),
			result = [],
			index;

		for (index = 0; index < length; index++) result.push(this._readString());
		return result;
	};




	Parser.prototype._readIntegerList = function () {
	
		var length = this._readInteger(),
			result = [],
			index;

		for (index = 0; index < length; index++) result.push(this._readInteger());
		return result;
	};




	Parser.prototype._readLocalsList = function () {
	
		var length = this._readInteger(),
			result = [],
			index;

		for (index = 0; index < length; index++) {
			result.push({
				varname: this._readString(),
				startpc: this._readInteger(),
				endpc: this._readInteger()
			});
		}
	
		return result;
	};




	Parser.prototype._readChunk = function () {
	
		var result = {
			sourceName: this._readString(),
			lineDefined: this._readInteger(),
			lastLineDefined: this._readInteger(),
			upvalueCount: this._readByte(),
			paramCount: this._readByte(),
			is_vararg: this._readByte(),
			maxStackSize: this._readByte(),
			instructions: this._parseInstructions(this._readInstructionList()),
			constants: this._readConstantList(),
			functions: this._readFunctionList(),
			linePositions: this._readIntegerList(),
			locals: this._readLocalsList(),
			upvalues: this._readStringList()
		};

		if (this._runConfig.stripDebugging) {
			delete result.linePositions;
			delete result.locals;
			delete result.upvalues;
		}
	
		return result;
	};




	Parser.prototype._parseInstructions = function (instructions) {
		var result = [];
		for (var i = 0, l = instructions.length; i < l; i++) result.push.apply(result, this._parseInstruction(instructions[i]));
		return result;
	};




	Parser.prototype._parseInstruction = function (instruction) {
		var data = '',
			result = [0, 0, 0, 0];
	
		for (var i = 0, l = instruction.length; i < l; i++) {
			data = ('0000000' + instruction.charCodeAt(i).toString(2)).substr(-8) + data;	// Beware: may need to be different for other endianess
		}

		result[0] = parseInt(data.substr(-6), 2);
		result[1] = parseInt(data.substr(-14, 8), 2);

		switch (result[0]) {
		
			// iABx
			case 1: //loadk
			case 5: //getglobal
			case 7: //setglobal
			case 36: //closure
				result[2] = parseInt(data.substr(-32, 18), 2);
				break;

			// iAsBx
			case 22: //jmp
			case 31: //forloop
			case 32: //forprep
				result[2] = parseInt(data.substr(-32, 18), 2) - 131071;
				break;
					
			// iABC
			default:
				result[2] = parseInt(data.substr(-32, 9), 2);
				result[3] = parseInt(data.substr(-23, 9), 2);
		}
	
		if (!this._runConfig.useInstructionObjects) return result;

		// Old file format for backward compatibility:
		return [{
			op: result[0],
			A: result[1],
			B: result[2],
			C: result[3]
		}];
	};




	if (typeof window == 'object') {
		// Browser
		shine.distillery = {
			Parser: Parser
		};
		
	} else {
		// eg. Node
		exports.Parser = Parser;
		

		var parser = new Parser(),
			filename, match;

		if (!module.parent && (filename = process.argv[2])) {
			parser.parse(filename, function (tree) {
				if (match = filename.match(/(.*)\.luac$/)) filename = match[1];
				
				require('fs').writeFile(filename + '.json', JSON.stringify(tree), function (err) {
					if (err) throw new Error(err);
					console.log('File written: ' + filename + '.json');
				});
			});
		}
	}	


})();