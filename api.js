const fs	= require('fs');
const log	= require('./log.js');
const err	= require('./errors.js');

class Database {
	constructor(name, keys, data) { //Data shold be an array: index -> [value for key1, value for key2...];
		this.name = name.trim();
		this.keys = keys;
		this.data = data;
		this.data_modified = false;

		//indexing...
		this.indexing();
		//this.index should be: index = [(key1) {value : index into data, ...}, (key2)...];
	}

	indexing() {
		log.logMessage(`Indexing database ${this.name}`);
		this.index = [];
		for(let key of this.keys) {
			this.index.push({}); //value -> index;
		}
		for(let ind = 0; ind < this.data.length; ind++) {
			let values = this.data[ind];
			for(let i = 0; i < values.length; i++) {
				if(!(values[i] in this.index[i])){
					this.index[i][values[i]] = []; //declare
				}
				this.index[i /*key index*/][values[i]].push(ind); //also in index row, you can find that value; 
			}
		}
	}

	/**
		usage: val_t(1, 'number', 'hello, world!', 'string') -> returns true;
				val_t(val1, val1_requested_type, ...);
		throws:
			Type-error, if one of the types of the arguments match doesn't match the requested type
	**/
	val_t(...args){
		for(let i = 0; i < args.length / 2; i+=2){
			if(typeof args[i] != args[i+1]){
				throw new err.Type(typeof args[i], args[i+1]);
			}
		}
	}

	validate(data) { //throws error, if invalid
		let data_valid = true;
		val_t(data, 'object');
		data.forEach(e => {if(typeof e != 'string') data_valid = false;});
		if(!data_valid) throw new err.InvalidData();
	}

	/**
		returns the index of the key in the keys array
	**/
	key_i(keyname){
		let i = this.keys.indexOf(keyname);
		if(i == -1) throw new err.Find('key', 'keys of the database');
		return i;
	}

	add_row(data_new) {
		validate(data_new);
		let new_index = this.data.length;
		this.data.push(data_new);
		for(let i = 0; i < data_new.length; i++) {
			if(!(data_new[i] in this.index[i])){
				this.index[i][data_new[i]] = []; //declare
			}
			this.index[i][data_new[i]].push(new_index);
		}
		this.data_modified = true;
		return new_index;
	}

	del_row(data_index) {
		val_t(data_index, 'number');
		if(data_index < 0 || data_index >= this.data.length) throw new err.Range('index');
		this.data_modified = true;
		this.data.splice(data_index, 1); //hopefully this works
		//possibly need to re-index //alternative: overwrite with DELETED (then deleted would be a keyword)
		indexing();
	}

	/**
		throws:
			- Find-error, if the key isn't in the keys array
			- Find-error, if the value isn't in the index of the key
	
	**/
	lookup_key_value(which_key, value) { //returns a list of indices in which the value for the key is satisfied.
		let i = key_i(which_key);
		let data_indices = this.index[i][value];
		if(!(data_indices) || data_indices.length === 0) throw new err.Find(value, 'index of the key');
		return data_indices;
	}

	/**
		throws:
			- Type-error, when the index isn't a string or the key isn't a string.
			- Range-error, when the index istn't in the required range.
			- Find-error, when the key is not in the database.
	**/
	lookup_index(index, key) {
		val_t(index, 'number', key, 'string');
		if(index < 0 || index >= this.data.length) throw new err.Range('index');
		let i = key_i(key);
		return this.data[index][i];
	}

	change_data(data_index, key, new_value) {
		val_t(data_index, 'number', key, 'string', new_value, 'string');
		if(index < 0 || index >= this.data.length) throw new err.Range('index');
		let i = key_i(key);
		let cache_i = this.index[i][this.data[data_index][i]].indexOf(data_index);
		this.index[i][this.data[data_index][i]].splice(cache_i, 1); //remove pointer to this row at index.
		if(this.index[i][this.data[data_index][i]].length === 0){
			delete this.index[i][this.data[data_index][i]];
		}
		
		this.data[data_index][i] = new_value;
		if(!(new_value in this.index[i])){
			this.index[i][new_value] = []; //declare
		}
		this.index[i][new_value].push(data_index);
		this.data_modified = true;
	}

	write_data() {
		this.data_modified = false;
		if(this.data.length <= 0) return false;
		let write_data = '';
		for (let key of this.keys) {
			write_data += key + ' ';
		}
		write_data += '\n';
		for (let row_i in this.data){
			for(let key_i in this.keys){
				write_data += this.data[row_i][key_i] + '\n';  
			}
		}

		fs.writeFile('./data/'+this.name, write_data, 'utf8', (err) => {
  			if (err) throw err;
  			log.logMessage(`The database ${this.name} has been saved!`);
		});
		return true;
	}
}



let databases = {}; //highly inefficient lookup for each database could result in long clustered lookups.
let possible_databases = [];

function initialize() {
	//prepare common databases maybe. index at loadup, not when in use...
	if(!fs.existsSync('./data')){
		log.logMessage('Creating database folder...');
		fs.mkdirSync('./data');
	}

	let files = fs.readdirSync('./data'); 
	for (file of files) {
		possible_databases.push(file);
	}
	load_database('invite_manager'); //TODO: Remove
	save_databases_interval();
}

function save_databases_interval(){
	let n = 0;
	for (database in databases){
		if(databases[database].data_modified === true){
			log.logMessage(`Saving database ${databases[database].name}`);
			if(databases[database].write_data() == true){
				n++;
			}
		}
	}
	if(n > 0) {
		log.logMessage(`Saved ${n} databases`);	
	}
	setTimeout(save_databases_interval, 50 * 1000);
}


function exists(database) {
	return possible_databases.indexOf(database) > -1;
}

function prepare_request(database){
	if(!exists(database)) throw new err.Unexisting(database);
	cache_dbs(database);
}

function database_create_if_not_exists(database, keys) {
	if(!exists(database)){
		create_database(database, keys);
	}
}

function database_row_add(database, data) {
	prepare_request(database);
	return databases[database].add_row(data);
}

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
		- 
**/
function lookup_key_value(database, key, value) { //what happens, when multiple modules acess the same database at the same time?!?!?
	prepare_request(database);
	return databases[database].lookup_key_value(key, value);
}

function lookup_index(database, index, key) { //get value at (index, key)
	prepare_request(database);
	return database[database].lookup_index(index, key);
}

function cache_dbs(database) { //loads the database from the cache, otherwise from disk
	if (!(database in databases)) {
		load_database(database);
	}
}

function load_database(database) { //should always be checked first, if this database truly exists.
	/*structure:
	row1 = keys; separated by spaces
	row2 (key1) = value_for_key1;
	row3 (key2) = value_for_key2;
	row4 (key1) = value2_for_key1;
	...
	*/ 
	log.logMessage(`Loading database ${database}`);
	let fi = fs.readFileSync('./data/' + database, "utf8"); //string
	let rows = fi.trim().split('\n');
	let keys = rows[0].trim().split(' ');
	let data = [];
	for(let i = 1; i < rows.length - 1; i+= keys.length) {
		let cache = [];
		for(let i_k = 0; i_k < keys.length; i_k++) {
			let row_index = i + i_k;
			cache.push(rows[row_index]);
		}
		data.push(cache);
	}

	databases[database] = new Database(database, keys, data);
}

function create_database(database, keys){
	if(database in databases){
		throw new err.Dublication(database);
	}else{
		databases[database] = new Database(database, keys, []);
		databases[database].data_modified = true;
	}
}

module.exports = {
	'initialize' : initialize,
	'lookup_key_value' : lookup_key_value,
	'load_database' : load_database,
	'create_database' : create_database,
	'exists' : exists,
	'lookup_index' : lookup_index,
	'database_row_add' : database_row_add,
	'database_row_delete' : database_row_delete,
	'database_row_change' : database_row_change,
	'database_create_if_not_exists' : database_create_if_not_exists

}
