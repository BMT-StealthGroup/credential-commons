'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var _ = require('lodash');
var Merkletools = require('merkle-tools');
var sjcl = require('sjcl');
var definitions = require('./definitions');
var UCA = require('../uca/UserCollectableAttribute');
var SecureRandom = require('../SecureRandom');

var _require = require('../services'),
    services = _require.services;

var anchorService = services.container.AnchorService;

function sha256(string) {
  return sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(string));
}

function getClaimPath(identifier) {
  var identifierComponentes = _.split(identifier, ':');
  var baseName = _.lowerCase(identifierComponentes[1]);
  return baseName + '.' + identifierComponentes[2];
}

function validIdentifiers() {
  var vi = _.map(definitions, function (d) {
    return d.identifier;
  });
  return vi;
}

/**
 * Transforms a list of UCAs into the signature property of the verifiable cliams
 */

var CivicMerkleProof = function () {
  _createClass(CivicMerkleProof, null, [{
    key: 'PADDING_INCREMENTS',
    get: function get() {
      return 16;
    }
  }]);

  function CivicMerkleProof(ucas) {
    _classCallCheck(this, CivicMerkleProof);

    var withRandomUcas = CivicMerkleProof.padTree(ucas);
    this.type = 'CivicMerkleProof2018';
    this.merkleRoot = null;
    this.anchor = 'TBD (Civic Blockchain Attestation)';
    this.leaves = CivicMerkleProof.getAllAttestableValue(withRandomUcas);
    this.buildMerkleTree();
  }

  _createClass(CivicMerkleProof, [{
    key: 'buildMerkleTree',
    value: function buildMerkleTree() {
      var _this = this;

      var merkleTools = new Merkletools();
      var hashes = _.map(this.leaves, function (n) {
        return sha256(n.value);
      });
      merkleTools.addLeaves(hashes);
      merkleTools.makeTree();
      _.forEach(hashes, function (hash, idx) {
        _this.leaves[idx].claimPath = getClaimPath(_this.leaves[idx].identifier);
        _this.leaves[idx].targetHash = hash;
        _this.leaves[idx].proof = merkleTools.getProof(idx);
      });
      this.leaves = _.filter(this.leaves, function (el) {
        return !(el.identifier === 'civ:Random:node');
      });
      this.merkleRoot = merkleTools.getMerkleRoot().toString('hex');
    }
  }], [{
    key: 'padTree',
    value: function padTree(nodes) {
      var currentLength = nodes.length;
      var targetLength = currentLength < CivicMerkleProof.PADDING_INCREMENTS ? CivicMerkleProof.PADDING_INCREMENTS : _.ceil(currentLength / CivicMerkleProof.PADDING_INCREMENTS) * CivicMerkleProof.PADDING_INCREMENTS;
      var newNodes = _.clone(nodes);
      while (newNodes.length < targetLength) {
        newNodes.push(new UCA('civ:Random:node', SecureRandom.wordWith(16)));
      }
      return newNodes;
    }
  }, {
    key: 'getAllAttestableValue',
    value: function getAllAttestableValue(ucas) {
      var values = [];
      _.forEach(ucas, function (uca) {
        var innerValues = uca.getAttestableValues();
        _.reduce(innerValues, function (res, iv) {
          res.push(iv);
          return res;
        }, values);
      });
      return values;
    }
  }]);

  return CivicMerkleProof;
}();
/**
 * Transforms a list of UCAs into the claim property of the verifiable cliams
 */


var ClaimModel = function ClaimModel(ucas) {
  var _this2 = this;

  _classCallCheck(this, ClaimModel);

  _.forEach(ucas, function (uca) {
    var rootPropertyName = uca.getClaimRootPropertyName();
    if (!_this2[rootPropertyName]) {
      _this2[rootPropertyName] = {};
    }
    _this2[rootPropertyName][uca.getClaimPropertyName()] = uca.getPlainValue();
  });
};
/**
 * Creates a new Verifiable Credential based on an well-known identifier and it's claims dependencies
 * @param {*} identifier 
 * @param {*} issuer 
 * @param {*} ucas 
 * @param {*} version 
 */


function VerifiableCredentialBaseConstructor(identifier, issuer, ucas, version) {
  var _this3 = this;

  this.id = null;
  this.issuer = issuer;
  this.issued = new Date().toISOString();
  this.identifier = identifier;

  if (!_.includes(validIdentifiers(), identifier)) {
    throw new Error(identifier + ' is not defined');
  }

  var definition = version ? _.find(definitions, { identifier: identifier, version: '' + version }) : _.find(definitions, { identifier: identifier });
  if (!definition) {
    throw new Error('Credential definition for ' + identifier + ' v' + version + ' not found');
  }
  this.version = version || definition.version;
  this.type = ['Credential', identifier];

  this.claims = new ClaimModel(ucas);
  this.signature = new CivicMerkleProof(ucas);

  if (!_.isEmpty(definition.excludes)) {
    var removed = _.remove(this.signature.leaves, function (el) {
      return _.includes(definition.excludes, el.identifier);
    });
    _.forEach(removed, function (r) {
      _.unset(_this3.claims, r.claimPath);
    });
  }

  /**
   * Creates a filtered credential exposing only the requested claims
   * @param {*} requestedClaims 
   */
  this.filter = function (requestedClaims) {
    var filtered = _.cloneDeep(_this3);
    _.remove(filtered.signature.leaves, function (el) {
      return !_.includes(requestedClaims, el.identifier);
    });

    filtered.claims = {};
    _.forEach(filtered.signature.leaves, function (el) {
      _.set(filtered.claims, el.claimPath, _.get(_this3.claims, el.claimPath));
    });

    return filtered;
  };

  /**
   * Request that this credential MerkleRoot is anchored on the Blochain.
   * This will return a _temporary_ anchor meaning that the blockchain entry is still not confirmed.
   * @param {*} options 
   */
  this.requestAnchor = function () {
    var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(options) {
      var anchor;
      return regeneratorRuntime.wrap(function _callee$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              _context.next = 2;
              return anchorService.anchor(_this3.identifier, _this3.signature.merkleRoot, options);

            case 2:
              anchor = _context.sent;

              _this3.signature.anchor = anchor;
              return _context.abrupt('return', _this3);

            case 5:
            case 'end':
              return _context.stop();
          }
        }
      }, _callee, _this3);
    }));

    return function (_x) {
      return _ref.apply(this, arguments);
    };
  }();

  /**
   * Trys to renew the current anchor. replecinf the _temporary_ anchor for a _permanent_ one,
   * already confirmed on the blockchain.
   */
  this.updateAnchor = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2() {
    var anchor;
    return regeneratorRuntime.wrap(function _callee2$(_context2) {
      while (1) {
        switch (_context2.prev = _context2.next) {
          case 0:
            _context2.next = 2;
            return anchorService.update(_this3.signature.anchor);

          case 2:
            anchor = _context2.sent;

            _this3.signature.anchor = anchor;
            return _context2.abrupt('return', _this3);

          case 5:
          case 'end':
            return _context2.stop();
        }
      }
    }, _callee2, _this3);
  }));

  return this;
}

module.exports = VerifiableCredentialBaseConstructor;