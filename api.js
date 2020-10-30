const fs = require("fs");
const log = require("./log.js");
const err = require("./errors.js");
const util = require("util");
const { prefix } = require("./config.json");

/**** CLASSES ****/
class Database {
	constructor(name, keys, data) {
		//Data shold be an array: index -> [value for key1, value for key2...]; values are json objects
		this.name = name.trim();
		this.keys = keys;
		this.data = data;
		this.data_modified = false;

		this.indexing(); //this.index should be: index = [(key1) {value : index into data, ...}, (key2)...];
	}
	/**
		throws:
			Nothing.
	**/
	indexing() {
		log.logMessage(`Indexing database ${this.name}`);
		this.index = [];
		for (let key of this.keys) {
			this.index.push({}); //value -> index;
		}
		for (let ind = 0; ind < this.data.length; ind++) {
			let values = this.data[ind];
			for (let i = 0; i < values.length; i++) {
				if (!(values[i] in this.index[i])) {
					this.index[i][values[i]] = []; //declare
				}
				this.index[i][values[i]].push(ind); //also in index row, you can find that value;
			}
		}
	}

	/**
		usage: val_t(1, 'number', 'hello, world!', 'string') -> returns true;
				val_t(val1, val1_requested_type, ...);
		throws:
			Type-error, if one of the types of the arguments match doesn't match the requested type
	**/
	val_t(...args) {
		for (let i = 0; i < args.length - 2; i += 2) {
			if (typeof args[i] != args[i + 1]) {
				throw new err.Type(typeof args[i], args[i + 1]);
			}
		}
	}

	validate_keys(param_keys) {
		if (param_keys.length != this.keys.length) throw new err.InvalidData();
		for (let i = 0; i < this.keys.length; i++) {
			if (this.keys[i] != param_keys[i]) throw new err.InvalidData();
		}
	}

	validate(data) {
		let data_valid = true;
		this.val_t(data, "object");
		if (data.length != this.keys.length) data_valid = false;
		data.forEach((e) => {
			try {
				for (let d of data) {
					JSON.stringify(d);
				}
			} catch (error) {
				data_valid = false;
				log.logMessage(error.message);
			}
		});
		if (!data_valid) throw new err.InvalidData();
	}

	/**
		returns the index of the key in the keys array
	**/
	key_i(keyname) {
		let i = this.keys.indexOf(keyname);
		if (i == -1) throw new err.Find("key", "keys of the database");
		return i;
	}

	/**
		executes the lambda with each row as a parameter
	**/
	async for_each(lambda) {
		for (let d of this.data) await lambda(d);
	}

	add_row(data_new) {
		this.validate(data_new);
		let new_index = this.data.length;
		this.data.push(data_new);
		for (let i = 0; i < data_new.length; i++) {
			if (!(data_new[i] in this.index[i])) {
				this.index[i][data_new[i]] = []; //declare
			}
			this.index[i][data_new[i]].push(new_index);
		}
		this.data_modified = true;
		return new_index;
	}

	/**
		throws:
			Range error
	**/
	del_row(data_index) {
		this.val_t(data_index, "number");
		if (data_index < 0 || data_index >= this.data.length)
			throw new err.Range("index");
		this.data_modified = true;
		this.data.splice(data_index, 1); //hopefully this works
		//possibly need to re-index //alternative: overwrite with DELETED (then deleted would be a keyword)
		this.indexing();
	}

	/**
		throws:
			- Find-error, if the key isn't in the keys array
			- Find-error, if the value isn't in the index of the key
	
	**/
	lookup_key_value(which_key, value) {
		//returns a list of indices in which the value for the key is satisfied.
		let i = this.key_i(which_key);
		let data_indices = this.index[i][value];
		if (!data_indices || data_indices.length === 0)
			throw new err.Find(value, "index of the key");
		return data_indices;
	}

	/**
		throws:
			- Type-error, when the index isn't a string or the key isn't a string.
			- Range-error, when the index istn't in the required range.
			- Find-error, when the key is not in the database.
	**/
	lookup_index(index, key) {
		this.val_t(index, "number", key, "string");
		if (index < 0 || index >= this.data.length) throw new err.Range("index");
		let i = this.key_i(key);
		return this.data[index][i];
	}

	change_data(data_index, key, new_value) {
		this.val_t(data_index, "number", key, "string", new_value, "string");
		if (data_index < 0 || data_index >= this.data.length)
			throw new err.Range("index");
		let i = this.key_i(key);
		let cache_i = this.index[i][this.data[data_index][i]].indexOf(data_index);
		this.index[i][this.data[data_index][i]].splice(cache_i, 1); //remove pointer to this row at index.
		if (this.index[i][this.data[data_index][i]].length === 0) {
			delete this.index[i][this.data[data_index][i]];
		}

		this.data[data_index][i] = new_value;
		if (!(new_value in this.index[i])) {
			this.index[i][new_value] = []; //declare
		}
		this.index[i][new_value].push(data_index);
		this.data_modified = true;
	}

	/**
	Writes the data on disk. If done so it returns true.
**/
	write_data() {
		if (this.data.length <= 0) return false;
		let write_data = "";
		for (let key of this.keys) {
			write_data += key + " ";
		}
		write_data += "\n";
		for (let row_i in this.data) {
			for (let key_in in this.keys) {
				write_data += JSON.stringify(this.data[row_i][key_in]) + "\n";
			}
		}

		fs.writeFile("./data/" + this.name, write_data, "utf8", (err) => {
			if (err) throw err;
			log.logMessage(`The database ${this.name} has been saved!`);
		});
		this.data_modified = false;
		return true;
	}
}

class Parameter {
	constructor(
		cmdname,
		type,
		dependent_params,
		description,
		arg_check_lambda,
		default_args
	) {
		this.cmdname = cmdname; //starts with minus
		this.type = type;
		this.dependent_params = dependent_params; /* {name : set_if_not_set}*/
		this.description = description;
		this.arg_check_lambda = arg_check_lambda;
		this.default_args = default_args;
	}

	getName() {
		return this.cmdname;
	}
}

class Command {
	constructor(name, parameter_list) {
		this.name = name;
		this.par_desc_map = {};
		for (let param of parameter_list) {
			if (param.type != "required" && param.type != "optional")
				throw new err.Command("init");
			for (let dep_name in param.dependent_params) {
				let found = false;
				for (let comp of parameter_list) {
					if (comp.cmdname == dep_name) found = true;
				}
				if (found == false) throw new err.Command("init");
			}
			if (!param.arg_check_lambda(param.default_args.length))
				throw new err.Command("init");
			this.par_desc_map[param.cmdname] = param;
		}
	}

	/**
		Checks the given parameter/arguments for matching with this command. Checking for modulename and prefix should happen before!!!
		This gets executed at first.
		Also autocompletes commands.

		returns 'params', if input passed the test; false, if input is wrong!

		throws:
			- Find-error, if a parameter is given (starting with a minus),
				but it's not inside the command parameter list.
			- ParameterArguments-error, 
				if the user has given the wrong amount of arguments to the parameter.
				This is determined by the arg_check_lambda
			- ParameterDependency-error,
				if the user didn't set a dependent parameter, which isn't default-initialized.
			- ParameterRequired-error,
				if the user didn't set a required parameter for the command.
			- Error, if the params dict is empty at the end of the function
	**/
	check() {
		if (arguments[0] != this.name) return false;
		let params = {};
		let cache_param;
		let cache_args = [];
		for (let i = 1; i < arguments.length; i++) {
			let arg = arguments[i];
			/* when it's a param and it's not in the list return false */
			if (arg.startsWith("-") && !(arg in this.par_desc_map)) {
				throw new err.Find(arg, `command parameter list for command ${this.name}`);
			} else if (arg.startsWith("-") && arg in this.par_desc_map) {
				/* check the cache_args vor validity using the lambda (length) */
				if (cache_param) {
					params[cache_param] = cache_args;
					cache_args = [];
				}
				cache_param = arg;
				continue;
			} else {
				cache_args.push(arg);
			}
		}
		/* add the last param and it's arguments to the param dict */
		if (cache_param) {
			params[cache_param] = cache_args;
		}
		/* check dependencies for each param */
		let changed_params = true;
		while (changed_params == true) {
			changed_params = false;
			for (let param_name in params) {
				let param = this.par_desc_map[param_name];
				let args = params[param_name];
				/* check argument length via lambda */
				if (!param.arg_check_lambda(args.length)) {
					throw new err.ParameterArguments(param_name);
				}
				for (let dep_name in param.dependent_params) {
					if (!(dep_name in params)) {
						let set_if_not_set = param.dependent_params[dep_name];
						if (set_if_not_set == true) {
							//assign the default arguments of this parameter to the param list
							let default_args = this.par_desc_map[dep_name].default_args;
							log.logMessage(
								`Default constructing parameter ${dep_name} with the arguments ${default_args}`
							);
							params[dep_name] = default_args;
							/* restart the while loop to ensure the default-constructed parameter gets it's dependencies checked */
							changed_params = true;
							continue;
						} else {
							throw new err.ParameterDependency(param_name, dep_name);
						}
					}
				}
			}
		}
		/* check for required parameters for this command */
		for (let param_name in this.par_desc_map) {
			if (
				this.par_desc_map[param_name].type == "required" &&
				!(param_name in params)
			) {
				throw new err.ParameterRequired(this.name, param_name);
			}
		}
		if (Object.keys(params).length == 0) throw new Error();
		return params;
	}
}

/**** FUNCTIONS ****/

let databases = {}; //highly inefficient lookup for each database could result in long clustered lookups.
let possible_databases = [];

function initialize() {
	if (!fs.existsSync("./data")) {
		log.logMessage("Creating database folder...");
		fs.mkdirSync("./data");
	}
	let files = fs.readdirSync("./data");
	for (file of files) {
		possible_databases.push(file);
	}
	save_databases_interval();
}

function save_databases() {
	if (bot["running"] != true) return;
	let n = 0;
	for (database in databases) {
		if (databases[database].data_modified === true) {
			if (databases[database].write_data() === true) {
				log.logMessage(`Saved database ${databases[database].name}`);
				n++;
			}
		}
	}
	if (n > 0) {
		log.logMessage(`Saved ${n} databases`);
	}
}

function save_databases_interval() {
	save_databases();
	setTimeout(save_databases_interval, 50 * 1000);
}

function exists(database) {
	return possible_databases.indexOf(database) > -1;
}

function prepare_request(database) {
	if (!exists(database)) throw new err.Unexisting(database);
	cache_dbs(database);
}

function database_create_if_not_exists(database, keys) {
	if (!exists(database)) {
		create_database(database, keys);
	} else {
		//TODO: this is new: check if it serves it purpose
		cache_dbs(database);
		databases[database].validate_keys(keys);
	}
}

async function database_for_each(database, lambda) {
	prepare_request(database);
	return await databases[database].for_each(lambda);
}

function database_row_add(database, data) {
	prepare_request(database);
	return databases[database].add_row(data);
}

/**
	throws
		Range error
**/
function database_row_delete(database, index) {
	prepare_request(database);
	return databases[database].del_row(index);
}

function database_row_change(database, data_index, key, new_value) {
	prepare_request(database);
	return databases[database].change_data(data_index, key, new_value);
}

/**
	returns a list of indices of the data in that database

	throws: 
		- Unexisting error, when the database is not exisiting
		- Find error, when key not in keys or value not in index[key]
**/
function lookup_key_value(database, key, value) {
	//what happens, when multiple modules acess the same database at the same time?!?!?
	prepare_request(database);
	return databases[database].lookup_key_value(key, value);
}

function lookup_index(database, index, key) {
	//get value at (index, key)
	prepare_request(database);
	return databases[database].lookup_index(index, key);
}

function cache_dbs(database) {
	//loads the database from the cache, otherwise from disk
	if (!(database in databases)) load_database(database);
}

function load_database(database) {
	//should always be checked first, if this database truly exists.
	/*structure:
	row1 = keys; separated by spaces
	row2 (key1) = value_for_key1;
	row3 (key2) = value_for_key2;
	row4 (key1) = value2_for_key1;
	...
	*/
	log.logMessage(`Loading database ${database}`);
	let fi = fs.readFileSync("./data/" + database, "utf8");
	let rows = fi.trim().split("\n");
	let keys = rows[0].trim().split(" ");
	let data = [];
	for (let i = 1; i < rows.length - 1; i += keys.length) {
		let cache = [];
		for (let i_k = 0; i_k < keys.length; i_k++) {
			let row_index = i + i_k;
			cache.push(JSON.parse(rows[row_index]));
		}
		data.push(cache);
	}

	databases[database] = new Database(database, keys, data);
}

function create_database(database, keys) {
	if (database in databases) {
		throw new err.Dublication(database);
	} else {
		log.logMessage("Creating database " + database);
		possible_databases.push(database);
		databases[database] = new Database(database, keys, []);
		databases[database].data_modified = true;
	}
}

/**
	This should be used, when using the 'message' event from discordjs.
	It parses the raw message to a dict of this structure:
	{
		name: commandName,
		params: {
			commandParam1 : parameter1Arguments,
			...
		}
	}
	if the message doesn't belong to the module, it returns false.
	if the commandname isn't found in the commandlist of the module it throws err.CommandNameNotFound.
		This leads to the fact, that you cannot have a commandlist without a single command.
	if the user input fails a check inside the specified command, it returns a Command-error,
		which conains a useful error message to log in the channel. (error.message)
**/
function parse_message(message, modulename, commands) {
	if (message.content[0] != prefix) return false;
	let split = message.content.substring(1).split(/\s+/);
	if (!split[0] || split[0] != modulename) return false;
	let param_args = split.slice(1); //cut the modulename from the array
	for (let cmd of commands) {
		try {
			let r = cmd.check(param_args);
			if (r != false) return { name: cmd.name, params: r };
		} catch (error) {
			if(error instanceof err.Find) {
				/* if a parameter is given (starting with a minus),
				but it's not inside the command parameter list. */
				throw new err.Command(error.message);
			}else if(error instanceof err.ParameterArguments){
				/* if the user has given the wrong amount of arguments to the parameter.
				This is determined by the arg_check_lambda */
				throw new err.Command(error.message);
			}else if(error instanceof err.ParameterDependency){
				/* if the user didn't set a dependent parameter, which isn't default-initialized. */
				throw new err.Command(error.message);
			}else if(error instanceof err.ParameterRequired) {
				/* if the user didn't set a required parameter for the command. */
				throw new err.Command(error.message);
			}else{
				throw error;
			}
		}
	}
	throw new err.CommandNameNotFound(param_args[0], modulename);
}

module.exports = {
	initialize: initialize,
	lookup_key_value: lookup_key_value,
	load_database: load_database,
	create_database: create_database,
	exists: exists,
	lookup_index: lookup_index,
	database_row_add: database_row_add,
	database_row_delete: database_row_delete,
	database_row_change: database_row_change,
	database_for_each: database_for_each,
	database_create_if_not_exists: database_create_if_not_exists,
	save_databases: save_databases,
	check_message: check_message,
};
