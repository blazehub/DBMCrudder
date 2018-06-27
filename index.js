var mongoose = require('mongoose');
var _ = require('lodash');

const init = (schema, modelName, options) => {
    const self = this;
    self.schema = schemaDefaults(schema);
    self.model = mongoose.model(modelName, self.schema, options.collectionName);
    self.index = index;
    self.show = show;
    self.create = create;
    self.update = update;
    self.Okay = Okay;
    self.Error = Error;
    self.NotFound = NotFound;
    console.log('Mongoose initialised...');
    return self;
};

const schemaDefaults = (schema) => {
    schema.add({
        createdAt: {
            type: Date,
            default: Date.now
        }
    });
    schema.add({
        lastUpdated: {
            type: Date,
            default: Date.now
        }
    });
    schema.add({
        deleted: {
            type: Boolean,
            default: false
        }
    });
    schema.index({
        lastUpdated: 1
    });
    schema.index({
        createdAt: 1
    });
    schema.pre('save', function (next) {
        this.lastUpdated = new Date();
        next();
    });
    schema.pre('update', function (next) {
        this.lastUpdated = new Date();
        next();
    });
    return schema;
}

const mapParams = (req) => {
    const paramMaps = Object.keys(req.swagger.params).reduce((prev, curr) => {
        prev[curr] = req.swagger.params[curr].value;
        return prev;
    }, {});
    return paramMaps;
}

const createRegexp = (str) => {
    if (str.charAt(0) === '/' &&
        str.charAt(str.length - 1) === '/') {
        var text = str.substr(1, str.length - 2).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
        return new RegExp(text, 'i');
    } else {
        return str;
    }
}

const resolveArray = (arr) => {
    const self = this;
    for (var x = 0; x < arr.length; x++) {
        if (typeof arr[x] === 'object') {
            arr[x] = self.filterParse(arr[x]);
        } else if (Array.isArray(arr[x])) {
            arr[x] = self.resolveArray(arr[x]);
        } else if (typeof arr[x] === 'string') {
            arr[x] = self.createRegexp(arr[x]);
        }
    }
    return arr;
}

const filterParse = (filterParsed) => {
    var self = this;
    for (var key in filterParsed) {
        if (typeof filterParsed[key] === 'string') {
            filterParsed[key] = createRegexp(filterParsed[key]);
        } else if (Array.isArray(filterParsed[key])) {
            filterParsed[key] = self.resolveArray(filterParsed[key]);
        } else if (typeof filterParsed[key] === 'object') {
            filterParsed[key] = self.filterParse(filterParsed[key]);
        }
    }
    return filterParsed;
}

const Okay = (res, data) => {
    res.status(200).json(data);
}

const NotFound = (res) => {
    res.status(404).send();
}

const Error = (res, err) => {
    if (err.errors) {
        var errors = [];
        Object.keys(err.errors).forEach(el => errors.push(err.errors[el].message));
        res.status(400).json({
            message: errors
        });
    } else {
        res.status(400).json({
            message: [err.message]
        });
    }
}

const createEntry = (model, payload, sendResponse) => {
    let entries = [];
    if (Array.isArray(payload)) {
        entries = payload;
    } else {
        entries.push(payload);
    }
    return Promise.map(entries, (entry) => {
        const entryModel = new model(payload);
        return entryModel.save();
    })
        .then(Promise.all);
}

const index = (req, res, sendResponse) => {
    const self = this;
    if (sendResponse === undefined) {
        sendResponse = true;
    }
    const reqParams = mapParams(req) || {};
    let filter = reqParams['filter'] ? reqParams.filter : {};
    const sort = reqParams['sort'] ? {} : {
        lastUpdated: -1
    };
    reqParams['sort'] ? reqParams.sort.split(',').map(el => el.split('-').length > 1 ? sort[el.split('-')[1]] = -1 : sort[el.split('-')[0]] = 1) : null;
    const select = reqParams['select'] ? reqParams.select.split(',') : [];
    const page = reqParams['page'] ? reqParams.page : -1;
    const count = reqParams['count'] ? reqParams.count : -1;

    if (typeof filter === 'string') {
        try {
            filter = JSON.parse(filter);
            filter = filterParse(filter);
        } catch (err) {
            filter = {};
        }
    }
    filter = _.assign({}, filter);
    filter.deleted = false;
    let query = self.model.find(filter);
    if (count > -1) {
        query = query.limit(count);
    }
    if (count > -1 && page > -1) {
        query = query.skip(count * (page - 1));
    }
    query
        .find(filter)
        .then((result) => {
            if (sendResponse) {
                Okay(res, result);
            }
        })
        .catch((err) => {
            if (sendResponse) {
                Error(res, err);
            }
        });
    if (!sendResponse) {
        return query;
    }
};

const show = (req, res, sendResponse) => {
    const self = this;
    if (sendResponse === undefined) {
        sendResponse = true;
    }
    const reqParams = mapParams(req) || {};

    const select = reqParams['select'] ? reqParams.select.split(',') : [];

    const query = this.model.findOne({
        _id: reqParams['id'],
        deleted: false
    });

    query
        .then((result) => {
            if (sendResponse) {
                if (!result)
                    NotFound(res);
                Okay(res, result);
            }
        })
        .catch((err) => {
            Error(res, err);
        });

    if (!sendResponse) {
        return query;
    }

};

const create = (req, res, sendResponse) => {
    const self = this;
    const params = mapParams(req) || {};
    const body = params['data'];
    const entryPromise = createEntry(self.model, body, sendResponse)
        .then((_created) => {
            if (sendResponse) {
                Okay(res, _created);
            }
        })
        .catch((err) => {
            if (sendResponse) {
                Error(res, err);
            }
        });
    if (!sendResponse) {
        return entryPromise;
    }
};

const update = (req, res, sendResponse) => {
    const self = this;
    const reqParams = mapParams(req);
    const body = reqParams['data'];
    let updated = {};
    if (body._id) {
        delete req.body._id;
    }
    const updatePromise = self.model.findOne({
        _id: reqParams['id'],
        deleted: false
    })
        .then((_result) => {
            if (!_result) {
                if (!sendResponse) {
                    return new Error({ code: 404 });;
                }
                NotFound(res);
            }
            updated = _.mergeWith(_result, body);
            updated = new self.model(updated);
            Object.keys(body).forEach(el => updated.markModified(el));
            return updated.save();
        })
        .then((_updated) => {
            if (sendResponse) {
                Okay(res, _updated);
            }
        })
        .catch((err) => {
            if (sendResponse) {
                Error(res, err);
            }
        });
    if (!sendResponse) {
        return updatePromise;
    }
}

module.exports = {
    init: init,
    index: index,
    show: show,
    create: create,
    update: update
}