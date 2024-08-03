const fs = require('fs'); // Needed for access to file-system
const path = require('path'); // Needed to manage path
const { parse, isValid } = require('date-fns');
const libxmljs = require('libxmljs'); // Needed to validate xml-xsd
const { xmlDocGetRootElement } = require('libxmljs/dist/lib/bindings/functions');

const config = {
  outputFilePath: './FW_test_logs/FW_test_val_error.txt',
  traverseErrorReportPath: './FW_test_logs/traverse_error_report.txt'
};


const green = '\u001b[32m'; // color green
const reset = '\u001b[0m';  // default color

const errorReportStructure = {
  errorType: '',
  errorCode: '',
  level: 0,
  message: '',
  location: {
    element: '',
    line: 0,
    column: 0,
    file: ''
  },
  details: {},
  suggestions: [],
  category: ''
};

// needed for User-Input
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

// ====================================CLASS DEFINITION(S)====================================
class XsdCache {
  // Caches parsed XSD documents for efficiency.
  constructor() {
    this.cache = {}; // Store parsed XSD documents by path
    this.cacheExpiration = 60 * 60 * 1000; // Default cache expiration time (1 hour)
  }

  get(xsdPath) {
    if (this.cache[xsdPath] && Date.now() - this.cache[xsdPath].timestamp < this.cacheExpiration) {
      return this.cache[xsdPath].doc;
    }
    return null;
  }

  set(xsdPath, xsdDoc) {
    this.cache[xsdPath] = {
      doc: xsdDoc,
      timestamp: Date.now()
    };
  }

  invalidate(xsdPath) {
    delete this.cache[xsdPath];
  }
}
//-------------------------------------------------------------------------------
//
const xsdCache = new XsdCache();


class XsdSyntaxError extends Error {
  constructor(message, line, column) {
      super(message);
      this.name = 'XsdSyntaxError';
      this.line = line;
      this.column = column;
  }
}
//-------------------------------------------------------------------------------

class XsdElementNotFoundError extends Error {
  constructor(message, elementName) {
      super(message);
      this.name = 'XsdElementNotFoundError';
      this.elementName = elementName;
  }
}
//-------------------------------------------------------------------------------

// Custom error classes to represent validation exceptions
class SchemaValidationException extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'SchemaValidationException';
    this.errors = errors; // Array of ValidationError objects
  }
}  //END class SchemaValidationException
//-------------------------------------------------------------------------------

class CustomValidationException extends Error {
  constructor(message) {
    super(message);
    this.name = 'CustomValidationException';
  }
}

//-------------------------------------------------------------------------------

class ElementOrderException extends Error {
  constructor(message) {
    super(message);
    this.name = 'ElementOrderException';
  }
}
//-------------------------------------------------------------------------------

class ResourceNotFoundError extends Error {
  constructor(message, resourceType) {
    super(message);
    this.name = 'ResourceNotFoundError';
    this.resourceType = resourceType;
  }
}
//-------------------------------------------------------------------------------


class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    // Add the following properties (optional for basic logging):
    this.code = undefined;
    this.level = undefined;
    this.line = undefined;
    this.column = undefined;
    this.domain = undefined;
    this.source = undefined;
  } // END constructor

  // Add a method to populate error details (optional)
  populateDetails(error) {
    this.code = error.code;
    this.level = error.level;
    this.line = error.line;
    this.column = error.column;
    this.domain = error.domain;
    this.source = error.source ? error.source.name : 'unknown';
  } // END Method populateDetails
} //END class ValidationError
//-------------------------------------------------------------------------------

class XmlParsingError extends Error {
    constructor(message, line, column) {
      super(message);
      this.name = 'XmlParsingError';
      this.code = code;
      this.line = line;
      this.column = column;
    }
} //END class XmlParsingError
//-------------------------------------------------------------------------------


// ====================================FUNCTION DECLARATION(S)====================================
function generateErrorReport(validationResults, outputFormat) {
  const report = generateHumanReadableReport(validationResults);

  if (outputFormat === 'file') {
    fs.writeFileSync(outputFilePath, report);
  } else {
    console.log(report);
  }
}
//===============================================================================

function generateOutput(validationResults, outputFormat = 'json') {
  const groupedErrors = {};

  validationResults.forEach(error => {
    const groupKey = `${error.errorType}-${error.location.file}`;
    if (!groupedErrors[groupKey]) {
      groupedErrors[groupKey] = {
        count: 0,
        errors: []
      };
    }
    groupedErrors[groupKey].count++;
    groupedErrors[groupKey].errors.push(error);
  });

  let output;
  switch (outputFormat) {
    case 'json':
      output = JSON.stringify(groupedErrors, null, 2);
      break;
    case 'text': // Example of another format
      output = generateHumanReadableOutput(groupedErrors);
      break;
    default:
      console.warn('Unsupported output format:', outputFormat);
      output = JSON.stringify(groupedErrors, null, 2);
  }

  return output;
}
//===============================================================================

function generateHumanReadableOutput(groupedErrors) {
  const report = [];
  for (const groupKey in groupedErrors) {
    const { count, errors } = groupedErrors[groupKey];
    report.push(`\nError group: ${groupKey} (count: ${count})`);
    errors.forEach(error => {
      report.push(`  - Level: ${error.level}, Message: ${error.message}`);
      // Add more details as needed
    });
  }
  return report.join('\n');
}

//===============================================================================

// Improved function to list existing XML & XSD files with error handling
async function listFiles(dirPath) {
  try {
    const files = await fs.promises.readdir(dirPath);
    const xmlFiles = files.filter(file => path.extname(file) === '.xml');
    const xsdFiles = files.filter(file => path.extname(file) === '.xsd');
    return { xmlFiles, xsdFiles };
  } catch (err) {
    console.error('Error reading directory:', err.message);
    return { xmlFiles: [], xsdFiles: [] }; // Return empty arrays on error
  }
} // END function listFiles
//===============================================================================
//-------------------------------------------------------------------------------
// Function to get user input for file selection
function getUserInput(message) {
  return new Promise((resolve, reject) => {
    readline.question(message, (answer) => {
      resolve(answer.trim());
    });
  });
} // END getUserInput
//===============================================================================

function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    // Handle file reading errors
    console.error('Error reading file:', err);
    throw err; // Rethrow the error for further handling
  }
}
//===============================================================================

function getXsdDoc(xsdPath) {
  const cachedXsd = xsdCache.get(xsdPath);
  if (cachedXsd) {
    return cachedXsd.doc;
  } else {
    const xsdString = fs.readFileSync(xsdPath, 'utf8');
    const xsdDoc = parseXsd(xsdString);

    //for debugging only
    console.log('xsdDoc type:', typeof xsdDoc); // Check xsdDoc type
    console.log('xsdDoc content:', xsdDoc.toString()); // Check xsdDoc content

    xsdCache.set(xsdPath, xsdDoc);
    return xsdDoc;
  }
}

//===============================================================================

// Function to parse XML content
function parseXml(xmlString) {
    try {
      // Convert JavaScript string to a buffer with encoding utf8
      const buffer = Buffer.from(xmlString, 'utf8');

      // Parse the XML from the buffer
      const xmlDoc = libxmljs.parseXml(buffer);
      return xmlDoc;

    } catch (err) {
      if (err.message.includes('XML parsing error')) {
        throw new XmlParsingError(err.message, err.line, err.column);
      } else {
        throw err;
      } // END catch(err)
    } // END catch
} // END function parseXML
//===============================================================================

// Function to parse XSD content with enhanced error handling
function parseXsd(xsdString) {
  try {
    //const xsdBuffer = Buffer.from(xsdString, 'utf8');
    const xsdDoc = libxmljs.parseXml(xsdString);

    // for debugging purposes ONLY
    //console.log('xsdDoc type:', typeof xsdDoc); // Check type
    //console.log('xsdDoc content:', xsdDoc.toString()); // Check content
    
    //const xsdDoc = parseXml(xsdString);
    return xsdDoc;
    } catch (err) {
    console.error('Error parsing XSD:', err.message);

    // Log the essential error details
    console.error({
      message: err.message,
      lineNumber: err.line || 'unknown',
      columnNumber: err.column || 'unknown',
      code: err.code || 'unknown',
      name: err.name || 'unknown',
      stack: err.stack || 'unknown'
    });

    // Classify error based on error message or code - check for specific error messages or codes and
    // throw the appropriate custom error
    let errorDetails = {}; // Declare errorDetails here
    if (err.message.includes('unexpected token')) {
      throw new XsdSyntaxError(err.message, err.line, err.column);
    } else if (err.message.includes('element is not declared')) {
        throw new XsdElementNotFoundError(err.message, 'missing element name'); // Replace with actual element name if available
      } else {
          errorDetails.type = 'UnknownError';
    }
  
      // Handle error based on error type
      switch (errorDetails.type) {
        case 'SyntaxError':
          console.error('XSD Syntax Error:', errorDetails);
          break;
        case 'ElementNotFoundError':
          console.error('XSD Element Not Found:', errorDetails);
          break;
        default:
          console.error('Unhandled XSD Parsing Error:', errorDetails);
      }
  
      // Re-throw the error or handle it appropriately
      throw err;
    }
}//END FUNCTION parseXSD
//===============================================================================

function handleComplexType(element, elementOrderMap, schemaData, unknownElements, validationResults, validationContext) {
  const sequence = element.get('sequence');
  if (sequence) {
    const elementOrder = [];
    sequence.children().filter(child => child.name === 'element').forEach(child => {
      elementOrder.push(child.attr('name'));
    });
    elementOrderMap[element.attr('name')] = elementOrder;
  }
}
//===============================================================================

function handleSimpleType(element, schemaData, validationResults) {
  const simpleTypeName = element.attr('name');
  const simpleType = schemaData.simpleTypes[simpleTypeName];

  if (simpleType && simpleType.base) {
    const elementValue = element.text();
    validateSimpleType(simpleType.base, elementValue, validationResults); // Call a generic validation function
  }
  // Additional checks based on facets (minInclusive, maxInclusive, etc.)
  if (simpleType.restrictions.minInclusive && intValue < simpleType.restrictions.minInclusive) {
    // Handle minimum value violation
  }
  if (simpleType.restrictions.maxInclusive && intValue > simpleType.restrictions.maxInclusive) {
    // Handle maximum value violation
  }

  return true; // Indicate validation success
}

//===============================================================================

function handleAnyType(element, validationResults, unknownElements) {
  // Basic validation moved to this function
  const prohibitedElements = ['forbiddenElement1', 'forbiddenElement2'];
  const prohibitedAttributes = ['forbiddenAttribute'];
  const maxLength = 1024; // Example maximum length

  if (prohibitedElements.includes(element.name())) {
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Prohibited element found: ${element.name()}`,
      element: element,
      category: 'schemaValidationError'
    });
  }

  element.attributes.forEach(attr => {
    if (prohibitedAttributes.includes(attr.name)) {
      validationResults.push({
        type: 'error',
        level: 2, // Adjust level as needed
        message: `Prohibited attribute found: ${attr.name}`,
        element: element,
      category: 'schemaValidationError'
      });
    }
  });

  if (element.textContent.length > maxLength) {
    validationResults.push({
      type: 'warning',
      level: 3, // Adjust level as needed
      message: `Content length exceeded: ${element.textContent.length}`,
      element: element,
      category: 'dataValidationError'
    });
  }

  // Store information about the anyType element
  unknownElements.push({
    name: element.name(),
    attributes: element.attrs(),
    textContent: element.text(),
    // Add other relevant information as needed
  });
}



//===============================================================================

function validateInteger(elementValue, simpleType, validationResults) {
  const intValue = parseInt(elementValue);
  if (isNaN(intValue)) {
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Value '${elementValue}' is not an integer for element ${element.name()}`,
      element: element,
      category: 'dataTypeValidationError'
    });
    return false; // Indicate validation failure
  }
//===============================================================================

function handleAttribute(element, schemaData) {
  const attributeName = element.attr('name');
  const attributeType = element.attr('type');
  const defaultValue = element.attr('default');
  const use = element.attr('use');
  schemaData.attributes[attributeName] = { attributeType, defaultValue, use };
}
//===============================================================================

function validateString(elementValue, simpleType, validationResults) {
  // Check for length restrictions, patterns, etc.
  if (simpleType.restrictions.minLength && elementValue.length < simpleType.restrictions.minLength) {
    // Handle minimum length violation
  }
  if (simpleType.restrictions.maxLength && elementValue.length > simpleType.restrictions.maxLength) {
    // Handle maximum length violation
  }
  if (simpleType.restrictions.pattern && !new RegExp(simpleType.restrictions.pattern).test(elementValue)) {
    // Handle pattern mismatch
  }

  return true; // Indicate validation success
}

//===============================================================================

function validateDecimal(elementValue, simpleType, validationResults) {
  const decimalValue = parseFloat(elementValue);
  if (isNaN(decimalValue)) {
    // Handle invalid decimal format
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Value '${elementValue}' is not a decimal for element ${element.name()}`,
      element: element,
      category: 'dataTypeValidationError'
    });
    return false;
  }

  // Additional checks based on facets (totalDigits, fractionDigits, etc.)
  if (simpleType.restrictions.totalDigits && elementValue.toString().length > simpleType.restrictions.totalDigits) {
    // Handle total digits violation
  }
  if (simpleType.restrictions.fractionDigits && elementValue.toString().split('.')[1].length > simpleType.restrictions.fractionDigits) {
    // Handle fraction digits violation
  }

  return true;
}
//===============================================================================

function validateBoolean(elementValue, simpleType, validationResults) {
  if (elementValue !== 'true' && elementValue !== 'false') {
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Value '${elementValue}' is not a boolean for element ${element.name()}`,
      element: element,
      category: 'dataTypeValidationError'
    });
    return false;
  }

  return true;
}
//===============================================================================

function validateDate(elementValue, simpleType, validationResults) {
  const parsedDate = parse(elementValue, 'yyyy-MM-dd', new Date());
  if (!isValid(parsedDate)) {
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Invalid date format: ${elementValue}`,
      element: element,
      category: 'dataTypeValidationError'
    });
    return false;
  }

  // Additional checks based on facets (minInclusive, maxInclusive, pattern)
  return true;
}
//===============================================================================

function validateTime(elementValue, simpleType, validationResults) {
  const parsedTime = parse(elementValue, 'HH:mm:ss', new Date());
  if (!isValid(parsedTime)) {
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Invalid time format: ${elementValue}`,
      element: element,
      category: 'dataTypeValidationError'
    });
    return false;
  }

  // Additional checks based on facets
  return true;
}
//===============================================================================


function validateDateTime(elementValue, simpleType, validationResults) {
  const parsedDateTime = parseISO(elementValue);
  if (!isValid(parsedDateTime)) {
    validationResults.push({
      type: 'error',
      level: 2, // Adjust level as needed
      message: `Invalid dateTime format: ${elementValue}`,
      element: element,
      category: 'dataTypeValidationError'
    });
    return false;
  }

  // Additional checks based on facets
  return true;
}
//===============================================================================

function traverse(element, elementOrderMap, elementHierarchy, schemaData, unknownElements, validationResults, validationContext) {
  try {
    if (!element || typeof element !== 'object') {
      throw new TypeError('Invalid element type: expected an object');
    }

    if (element.name() !== 'element') {
      return; // Skip non-element nodes
    }

    switch (element.name()) {
      case 'complexType':
        handleComplexType(element, elementOrderMap, schemaData, unknownElements, validationResults, validationContext);
        break;
      case 'simpleType':
        handleSimpleType(element, schemaData, validationResults);
        break;
      case 'attribute':
        handleAttribute(element, schemaData);
        break;
      case 'anyType':
        handleAnyType(element, validationResults, unknownElements);
        break;
      default:
        console.warn('Unhandled element type:', element.name());
        unknownElements.push({
          name: element.name(),
          attributes: element.attrs(),
          // Add other relevant information as needed
        });
        break;
    }

    elementHierarchy.push(element.name()); // Add current element to hierarchy

    element.children().forEach(child => traverse(child, elementOrderMap, elementHierarchy, schemaData, unknownElements, validationResults, validationContext));

    elementHierarchy.pop(); // Remove current element from hierarchy
  } catch (err) {
    console.error('Error traversing element:', err);

    // Specific error handling based on error type (optional):
    if (err instanceof TypeError) {
      console.error('TypeError:', err.message);
      // Handle type-related errors
    } else if (err instanceof ReferenceError) {
      console.error('ReferenceError:', err.message);
      // Handle reference errors
    } else {
      console.error('Unexpected error:', err);
      // Handle other errors
    }

    // Rethrow the error or handle it appropriately
    throw err; // Or comment this line to suppress rethrowing
  }
}

//===============================================================================

function loadFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    // Handle file reading errors
    console.error('Error reading file:', err);
    throw err; // Rethrow the error for further handling
  }
}
//===============================================================================

async function prepareValidationData(xmlPath, xsdPath) {
  try {
    const xmlString = await loadFileContent(xmlPath); // Assuming loadFileContent is async
    const xsdDoc = await getXsdDoc(xsdPath); // Assuming getXsdDoc is async
    const xmlDoc = await parseXml(xmlString); // Assuming parseXml is async

    return { xmlDoc, xsdDoc };
  } catch (error) {
    console.error('Error in prepareValidationData:', error);
    throw error; // Rethrow the error for handling in the calling function
  }
}
//===============================================================================

function handleValidationError(err) {
  if (err.code === 'ENOENT') {
    // ... handle file not found error
  } else if (err instanceof XmlParsingError) {
    // ... handle XML parsing error
  } else if (err instanceof XsdSyntaxError) {
    // ... handle XSD syntax error
  } else if (err instanceof XsdElementNotFoundError) {
    // ... handle XSD element not found error
  } else {
    // ... handle other errors
  }
}
//===============================================================================

function extractElementOrderFromXsd(xsdDoc) {
  const elementOrderMap = {};

  // Assuming a simple structure with sequences and elements
  const sequenceElements = xsdDoc.find('//xs:sequence/xs:element');

  sequenceElements.forEach(element => {
    const elementName = element.attr('name');
    const parentName = element.parent().parent().name(); // Assuming parent is a complexType

    if (!elementOrderMap[parentName]) {
      elementOrderMap[parentName] = [];
    }

    elementOrderMap[parentName].push(elementName);
  });

  return elementOrderMap;
}

/*
// Function to validate XML against XSD
async function validateXML(validationData, elementOrderMap) {
  try {
    const { xmlDoc, xsdDoc } = validationData;

    // for Debuging purposes only
    //console.log(typeof xsdDoc); // Check schemaDoc type
    //console.log(xsdDoc.toString()); // Inspect schemaDoc content

    // Custom validation logic: Check title length
    const titleElements = xmlDoc.find('//title');
    for (const titleElement of titleElements) {
      const titleText = titleElement.text();
      if (titleText.length <= 10) {
        throw new ValidationError('Title length must be greater than 10 characters');
      }
    }

    // ... other custom validation rules ...

    // Custom element order validation (if needed)
    if (elementOrderMap) {
      const xmlDoc = validationData.xmlDoc;
      const rootElement = xmlDoc.root();
      const expectedOrder = elementOrderMap[rootElement.name()];
      if (expectedOrder && !validateElementOrder(rootElement, expectedOrder)) {
        throw new ValidationError('Element order violation');
      }
    }

    const isValid = xmlDoc.validate(xsdDoc);
    console.log('in validateXML: Result after Validatiion: ', isValid); // Check isValid value

    if (!isValid) {
      const validationErrors = xmlDoc.validationErrors.map(error => {
        const validationError = new ValidationError(error.message);
        validationError.populateDetails(error);
        return validationError;
      });
      throw new SchemaValidationException('Schema validation failed', validationErrors);
    }

    // Handle warnings
    if (xmlDoc.validationErrors.length > 0) {
      console.warn('Validation completed with warnings:');
      // ... handle warnings (e.g., format errors, log to file)
      const warningMessages = xmlDoc.validationErrors.map(error => error.message);
      // Perform additional actions with warning messages (e.g., store in a log file)
    } else {
      console.log('XML document is valid');
    }
    
    console.log('in validateXML: Value of isValid prior to returning it: ', isValid); // Check isValid value
    return isValid;
    
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error('Validation error:', err.message);
      // Handle specific validation errors (e.g., log, retry, etc.)
    } else if (err instanceof SchemaValidationException) {
      console.error('Schema validation failed:', err.message);
      // Handle schema validation errors (e.g., log, retry, etc.)
      err.errors.forEach(validationError => {
        console.error('Validation error:', validationError.message);
        // Access other validation error details:
        console.error('  Code:', validationError.code);
        console.error('  Level:', validationError.level);
        console.error('  Line:', validationError.line);
        console.error('  Column:', validationError.column);
        console.error('  Domain:', validationError.domain);
        console.error('  Source:', validationError.source);
      });
    } else {
      // Handle other validation errors
      console.error('Unexpected error during validation:', err);
      throw err; // Rethrow for further handling
    }
    // Indicate failure in all error cases
    return false;
  }
}  //END FUNCTION validateXML
*/

// Helper Function for validateXML
function validateAgainstSchema(xmlDoc, xsdDoc) {
  const isValid = xmlDoc.validate(xsdDoc);

  if (!isValid) {
    throw new SchemaValidationException('Schema validation failed', xmlDoc.validationErrors);
  }

  return isValid;
}

// Helper Function for validateXML
function validateCustomRules(xmlDoc) {
  const titleElements = xmlDoc.find('//title');
  for (const titleElement of titleElements) {
    const titleText = titleElement.text();
    if (titleText.length <= 10) {
      throw new CustomValidationException('Title length must be greater than 10 characters');
    }
  }

  // Weitere benutzerdefinierte Regeln können hier hinzugefügt werden
}

// Helper Function for validateXML
function validateElementOrder(xmlDoc, elementOrderMap) {
  const rootElement = xmlDoc.root();
  const expectedOrder = elementOrderMap[rootElement.name()];
  if (expectedOrder && !validateElementOrderHelper(rootElement, expectedOrder)) {
    throw new ValidationError('Element order violation');
  }
}

// NEW Helper Function for validateXML
function validateElementOrderHelper(element, expectedOrder, currentPosition = 0) {
  // Basisfall: Wenn das Element kein Kind hat oder wenn die erwartete Reihenfolge vollständig abgearbeitet wurde, ist alles in Ordnung
  if (currentElementName !== expectedOrder[currentPosition]) {
    throw new ElementOrderException('Element order violation at element: ' + element.name());
  }
  if (!element.children().length || currentPosition >= expectedOrder.length) {
    return true;
  }

  // Hole den Namen des aktuellen Elements
  const currentElementName = element.name();

  // Vergleiche den aktuellen Elementnamen mit dem erwarteten Element an der aktuellen Position
  if (currentElementName !== expectedOrder[currentPosition]) {
    return false; // Reihenfolge stimmt nicht überein
  }

  // Rekursiv die Kinder überprüfen
  for (let i = 0; i < element.children().length; i++) {
    if (!validateElementOrderHelper(element.children()[i], expectedOrder, currentPosition + 1)) {
      return false;
    }
  }

  return true; // Alle Kinder entsprechen der erwarteten Reihenfolge
}


// Refactored validateXML function
function validateXML(validationData) {
  try {
    const { xmlDoc, xsdDoc } = validationData;

    // Perform schema validation
    const isValid = validateAgainstSchema(xmlDoc, xsdDoc);

    // Extract element order information from XSD
    const elementOrderMap = extractElementOrderFromXsd(xsdDoc);

    // Perform custom validation
    validateCustomRules(xmlDoc);

    // Perform element order validation based on extracted map
    if (elementOrderMap) {
      validateElementOrder(xmlDoc, elementOrderMap);
    }

    return isValid;
  } catch (error) {
  let errorMessage;
  if (error instanceof SchemaValidationException) {
    errorMessage = `Schema validation failed:\n${error.errors.map(err => `- ${err.message}`).join('\n')}`;
  } else if (error instanceof CustomValidationException) {
    errorMessage = `Custom validation failed: ${error.message}`;
  } else if (error instanceof ElementOrderException) {
    errorMessage = `Element order violation: ${error.message}`;
  } else {
    errorMessage = `Unexpected error: ${error.message}`;
  }

  // console.error(errorMessage); // can be deleted at later time
  //console.error(error.stack); // Loggen des Stacktrace - can be deleted at later time
    // Loggen des Fehlers
    console.error(errorMessage);

    // Weitere Aktionen, z.B. Benachrichtigung des Benutzers, Speichern des Fehlers in einer Datenbank

    return false;
    }
  }
}


// =======================================================

// Function to format validation errors for logging in handleError
function formatValidationErrors(errors) {
  return errors.map(error => {
    const formattedError = {
      message: error.message,
      code: error.code || 'unknown',
      level: error.level || 'unknown',
      line: error.line || 'unknown',
      column: error.column || 'unknown',
      domain: error.domain || 'unknown',
      source: error.source ? error.source.name : 'unknown'
    };

    // Add specific error messages based on error code
    if (error.code === 'missingElement') {
      formattedError.message = `Missing required element: ${error.elementName}`;
    } else if (error.code === 'invalidType') {
      formattedError.message = `Invalid data type for element: ${error.elementName}`;
    } else if (error.code === 'missingAttribute') {
      formattedError.message = `Missing required attribute: ${error.attributeName}`;
    } else if (error.code === 'invalidValue') {
      formattedError.message = `Invalid value for attribute: ${error.attributeName}`;
    }

    return formattedError;
  });
}
//===============================================================================

// Function to write detailed errors to a file (optional)
function writeDetailedErrorsToFile(errors, filePath) {
  // Implement logic to write errors to a file (e.g., JSON format)
  const errorMessages = [];
  errors.forEach(error => {
    // ... logic to format error details ...
    errorMessages.push(JSON.stringify(errorDetails));
  });
  fs.writeFileSync(filePath, errorMessages.join('\n'));
}
//===============================================================================

function handleError(err) {
  if (err instanceof SchemaValidationException) {
    console.error('Schema validation failed:', err.message);
    err.errors.forEach(validationError => {
      console.error('Validation error:', validationError.message);
      // Access other validation error details:
      console.error('  Code:', validationError.code);
      console.error('  Level:', validationError.level);
      console.error('  Line:', validationError.line);
      console.error('  Column:', validationError.column);
      console.error('  Domain:', validationError.domain);
      console.error('  Source:', validationError.source);
      // Handle specific validation errors based on their details
    });
  } else if (err instanceof XsdSyntaxError) {
    console.error('XSD Syntax Error:', err.message, 'at line:', err.line, 'column:', err.column);
  } else if (err instanceof XsdElementNotFoundError) {
    console.error('XSD Element Not Found:', err.message, 'element:', err.elementName);
  } else {
    // Handle other errors
    console.error('Unexpected error:', err.message);
  }
}
//===============================================================================

async function main() {
  try {
    const directory = './xmlxsddata';

    const { xmlFiles, xsdFiles } = await listFiles(directory);
    if (xmlFiles.length === 0 || xsdFiles.length === 0) {
      console.error('No XML or XSD files found in the directory.');
      return;
    }

    // User interface for file selection
    console.log('Available XML files:');
    xmlFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });

    console.log('\nAvailable XSD files:');
    xsdFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });

    let continueValidation = true;
    while (continueValidation) {
      const selectedXmlIndex = await getUserInput('Select XML file (enter number): ');
      const selectedXsdIndex = await getUserInput('Select XSD file (enter number): ');

      // Input validation
      if (isNaN(selectedXmlIndex) || isNaN(selectedXsdIndex)) {
        console.error('Invalid input. Please enter numbers.');
        continue;
      }

      const xmlIndex = parseInt(selectedXmlIndex, 10) - 1;
      const xsdIndex = parseInt(selectedXsdIndex, 10) - 1;

      if (xmlIndex < 0 || xmlIndex >= xmlFiles.length || xsdIndex < 0 || xsdIndex >= xsdFiles.length) {
        console.error('Invalid file selection.');
        continue;
      }

      const xmlFilePath = path.join(directory, xmlFiles[xmlIndex]);
      const xsdFilePath = path.join(directory, xsdFiles[xsdIndex]);

      try {
        const validationData = await prepareValidationData(xmlFilePath, xsdFilePath);
        // Ask for custom element order validation
        const validateElementOrder = await getUserInput('Perform custom element order validation? (y/n): ');
        let elementOrderMap;
        if (validateElementOrder.toLowerCase() === 'y') {
          elementOrderMap = extractElementOrder(xsdFilePath);
        }

        // Validate XML
        const isValid = await validateXML(validationData, elementOrderMap);

        if (isValid) {
          console.log('XML document', xmlFilePath, 'is valid');
        } else {
          console.error('Validation failed for:', xmlFilePath);
          // Handle validation failures more specifically
        }
      } catch (err) {
        console.error('Error during validation:', err);
        console.error(err.stack); // For debugging
        handleValidationError(err);
      }

      // Ask user if they want to continue
      const continueChoice = await getUserInput('Do you want to validate another file? (y/n): ');
      continueValidation = continueChoice.toLowerCase() === 'y';
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    readline.close();
  }
}
    //END FUNCTION main()

// Call main function
main();