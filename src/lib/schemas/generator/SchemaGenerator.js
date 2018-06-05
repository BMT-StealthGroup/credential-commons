/* eslint-disable no-use-before-define */
const randomString = require('randomstring');
const UCA = require('../../uca/UserCollectableAttribute');
const ucaDefinitions = require('../../uca/definitions');
const Type = require('type-of-is');

const DRAFT = 'http://json-schema.org/draft-07/schema#';

const getPropertyNameFromDefinition = (definition) => {
  const substrIndex = definition.identifier.lastIndexOf('.') > -1 ? definition.identifier.lastIndexOf('.') + 1 :
    definition.identifier.lastIndexOf(':') + 1;
  return definition.identifier.substring(substrIndex);
};

/**
 * Generate json schemas from JSON sample data generated from UCA/Credentials identifiers
 */
const getPropertyFormat = (value) => {
  const type = Type.string(value).toLowerCase();

  if (type === 'date') return 'date-time';

  return null;
};

const getPropertyType = (value) => {
  const type = Type.string(value).toLowerCase();

  if (type === 'date') return 'string';
  if (type === 'regexp') return 'string';
  if (type === 'function') return 'string';

  return type;
};

const getUniqueKey = (property, requiredArray) => {
  const required = requiredArray || [];
  console.log(property);
  return required;
};

const processObject = (object, outputParam, nested) => {
  let output = outputParam;
  if (nested && output) {
    output = {
      properties: output,
    };
  } else {
    output = output || {};
    output.type = getPropertyType(object);
    output.properties = output.properties || {};
  }
  const keys = Object.entries(object);
  // too much debate on this eslint
  // https://github.com/airbnb/javascript/issues/1122
  // eslint-disable-next-line no-restricted-syntax
  for (const [key, value] of keys) {
    let type = getPropertyType(value);
    const format = getPropertyFormat(value);
    type = type === 'undefined' ? 'null' : type;
    if (type === 'object') {
      output.properties[key] = processObject(value, output.properties[key]);
    } else if (type === 'array') {
      // recursion
      // eslint-disable-next-line
      output.properties[key] = processArray(value, output.properties[key]);
    } else if (output.properties[key]) {
      const entry = output.properties[key];
      const hasTypeArray = Array.isArray(entry.type);
      // When an array already exists, we check the existing
      // type array to see if it contains our current property
      // type, if not, we add it to the array and continue
      if (hasTypeArray && entry.type.indexOf(type) < 0) {
        entry.type.push(type);
      }
      // When multiple fields of differing types occur,
      // json schema states that the field must specify the
      // primitive types the field allows in array format.
      if (!hasTypeArray && entry.type !== type) {
        entry.type = [entry.type, type];
      }
    } else {
      output.properties[key] = {};
      output.properties[key].type = type;
      if (format) {
        output.properties[key].format = format;
      }
    }
  }
  return nested ? output.properties : output;
};

const processArray = (array, outputParam, nested) => {
  let format;
  let oneOf;
  let type;
  let output = outputParam;

  if (nested && output) {
    output = { items: output };
  } else {
    output = output || {};
    output.type = getPropertyType(array);
    output.items = output.items || {};
    type = output.items.type || null;
  }

  // Determine whether each item is different
  for (let arrIndex = 0, arrLength = array.length; arrIndex < arrLength; arrIndex += 1) {
    const elementType = getPropertyType(array[arrIndex]);
    const elementFormat = getPropertyFormat(array[arrIndex]);

    if (type && elementType !== type) {
      output.items.oneOf = [];
      oneOf = true;
      break;
    } else {
      type = elementType;
      format = elementFormat;
    }
  }

  // Setup type otherwise
  if (!oneOf && type) {
    output.items.type = type;
    if (format) {
      output.items.format = format;
    }
  } else if (oneOf && type !== 'object') {
    output.items = {
      oneOf: [{
        type,
      }],
      required: output.items.required,
    };
  }

  // Process each item depending
  if (typeof output.items.oneOf !== 'undefined' || type === 'object') {
    for (let itemIndex = 0, itemLength = array.length; itemIndex < itemLength; itemIndex += 1) {
      const value = array[itemIndex];
      const itemType = getPropertyType(value);
      const itemFormat = getPropertyFormat(value);
      let arrayItem;
      if (itemType === 'object') {
        if (output.items.properties) {
          output.items.required = getUniqueKey(value, output.items.required);
        }
        arrayItem = processObject(value, oneOf ? {} : output.items.properties, true);
      } else if (itemType === 'array') {
        arrayItem = processArray(value, oneOf ? {} : output.items.properties, true);
      } else {
        arrayItem = {};
        arrayItem.type = itemType;
        if (itemFormat) {
          arrayItem.format = itemFormat;
        }
      }
      if (oneOf) {
        const childType = Type.string(value).toLowerCase();
        const tempObj = {};
        if (!arrayItem.type && childType === 'object') {
          tempObj.properties = arrayItem;
          tempObj.type = 'object';
          arrayItem = tempObj;
        }
        output.items.oneOf.push(arrayItem);
      } else if (output.items.type === 'object') {
        output.items.properties = arrayItem;
      }
    }
  }
  return nested ? output.items : output;
};

const process = (definition, json) => {
  let object = json;
  let title = definition.identifier;
  let processOutput;
  const output = {
    $schema: DRAFT,
  };

  // Determine title exists
  if (typeof title !== 'string') {
    object = title;
    title = undefined;
  } else {
    output.title = title;
  }

  // Set initial object type
  output.type = Type.string(object).toLowerCase();

  // Process object
  if (output.type === 'object') {
    processOutput = processObject(object);
    output.type = processOutput.type;
    output.properties = processOutput.properties;
  }

  if (output.type === 'array') {
    processOutput = processArray(object);
    output.type = processOutput.type;
    output.items = processOutput.items;

    if (output.title) {
      output.items.title = output.title;
      output.title += ' Set';
    }
  }

  // for simple UCA get json schema properties
  if (typeof definition !== 'undefined' && definition !== null) {
    if (Array.isArray(definition.required)) {
      output.required = definition.required;
    } else if (definition.required) {
      output.required = [getPropertyNameFromDefinition(definition)];
    }
    if (typeof definition.minimum !== 'undefined' && definition.minimum !== null) {
      if (definition.exclusiveMinimum) {
        output.exclusiveMinimum = definition.minimum;
      } else {
        output.minimum = definition.minimum;
      }
    }
    if (typeof definition.maximum !== 'undefined' && definition.maximum !== null) {
      if (definition.exclusiveMaximum) {
        output.exclusiveMaximum = definition.maximum;
      } else {
        output.maximum = definition.maximum;
      }
    }
  }
  // never allow additionalProperties
  output.additionalProperties = false;
  // Output
  return output;
};

/**
 * Build a sample json from an definition identifier
 * Recursively make the UCA from nested properties and UCA references
 *
 * TODO minimum: 0,
 * TODO exclusiveMinimum: true,
 * TODO maximum: 32,
 * TODO exclusiveMaximum: true,
 * TODO array -> values
 * TODO DocType
 *
 * @param definition receive an UCA and build an sample json from it's properties
 * @returns {{$schema: string}}
 */
const buildSampleJson = (definition) => {
  let output = {};
  output = makeJsonRecursion(definition);
  return output;
};

const makeJsonRecursion = (ucaDefinition) => {
  let output = {};
  const typeName = UCA.getTypeName(ucaDefinition);
  if (typeof ucaDefinition.type === 'object' && ucaDefinition.type.properties !== undefined) { // array of properties
    ucaDefinition.type.properties.forEach((property) => {
      output[property.name] = generateRandomValueForType(property.type);
    });
  } else if (typeName !== 'Object') { // not a reference
    const propertyName = getPropertyNameFromDefinition(ucaDefinition);
    output[propertyName] = generateRandomValueForType(ucaDefinition.type);
  } else { // a direct reference to a composite type
    output = generateRandomValueForType(ucaDefinition.type);
  }
  return output;
};

const generateRandomValueForType = (typeName) => {
  let refDefinition = null;
  let resolvedTypeName = typeName;
  if (typeName.includes(':')) { // simple composite, one depth level civ:Identity.name for example
    refDefinition = ucaDefinitions.find(def => def.identifier === typeName);
    if (refDefinition !== null) {
      resolvedTypeName = refDefinition.type;
    }
  }
  // generate sample data
  // that's why the magic numbers are here
  switch (resolvedTypeName) {
    case 'String':
      return randomString.generate(10);
    case 'Number':
      return Math.random() * 100;
    case 'Boolean':
      return (Math.round(Math.random()) === 1);
    default:
      return makeJsonRecursion(refDefinition);
  }
};

module.exports = { process, buildSampleJson };