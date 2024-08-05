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
// class XsdCache {
  
// const xsdCache = new XsdCache();

//-------------------------------------------------------------------------------

//Klasse für den dynamischen Stapel (verkette Liste) zur Elementordnungsvalidierung
class Node {
    constructor(data) {
      this.data = data;
      this.next = null;
    }
  }
  
  class ElementStack {
    constructor() {
      this.top = null;
    }
  
    push(data) {
      const newNode = new Node(data);  
  
      newNode.next = this.top;
      this.top = newNode;
    }
  
    pop() {
      if (this.isEmpty()) {
        return null;
      }
      const topNode = this.top;
      this.top = this.top.next;
      return topNode.data;
    }
  
    peek() {
      if (this.isEmpty()) {
        return null;
      }
      return this.top.data;
    }
  
    isEmpty() {
      return this.top === null;
    }
    size() {
        let count = 0;
        let current = this.top;
        while (current !== null) {
          count++;
          current = current.next;
        }
        return count;
      }

      getElements() {
        const elements = [];
        let current = this.top;
        while (current !== null) {
          elements.push(current.data);
          current = current.next;
        }
        return elements;
      }
  }
//-------------------------------------------------------------------------------


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

//???????????????????????

function validateElementOrder(element, elementOrderMap, validationResults) {
    const stack = new ElementStack();
  
    // Durchlaufe alle Kinder des Elements
    for (const child of element.children()) {
      stack.push(child.name());
  
      // Hole das erwartete nächste Element aus der Map
      const expectedNextElement = elementOrderMap[stack.peek()];
  
      // Vergleiche das erwartete Element mit dem aktuellen Element auf dem Stapel
      if (child.name() !== expectedNextElement) {
        validationResults.push({
          message: `Ungültige Elementreihenfolge: Erwartet ${expectedNextElement}, gefunden ${child.name()}`,
          element: child // Optional: Referenz auf das fehlerhafte Element
        });
        // Hier können Sie weitere Aktionen ausführen, z.B. das Abbrechen der Validierung
      }
  
      // Entferne das verarbeitete Element vom Stapel
      stack.pop();
    }
  
    // Am Ende sollte der Stapel leer sein
    if (!stack.isEmpty()) {
      validationResults.push({
        message: 'Nicht alle erwarteten Elemente wurden gefunden.'
      });
    }
  }
  

//???????????????????????

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

async function readFileContent(filePath) {
  try {
    const data = await fs.promises.readFile(filePath, 'utf8');
    return data;
  } catch (err) {
    console.error('Error reading file:', err);
    throw err;
  }
}
//===============================================================================


async function getXsdDoc(xsdPath) {
    try {
      if (!fs.existsSync(xsdPath)) {
        throw new Error(`XSD file not found: ${xsdPath}`);
      }
  
      const xsdString = await readFileContent(xsdPath); // Use the asynchronous readFileContent
      const xsdDoc = libxmljs.parseXml(xsdString);

      console.log('typeof xsdDoc in getXsdDoc before return  :', typeof xsdDoc); //DBUGGING
      console.log('xsdDoc in getXsdDoc before return         :', xsdDoc); //DEBUGGING

      return xsdDoc;
    } catch (error) {
      console.error('Error retrieving XSD:', error);
      throw error;
    }
  }
//===============================================================================
  
async function prepareValidationData(xmlPath, xsdPath) {
  console.log('XML Path in prepareValidationData  :', xmlPath); //DUBUGGING
  console.log('XSD Path in prepareValidationData  :', xsdPath); //DEBUGGING
  
  try {
    const xmlString = await loadFileContent(xmlPath);
    const xsdDoc = await getXsdDoc(xsdPath);
    const xmlDoc = await parseXml(xmlString);
    console.log('XML Doc in prepareValidationData after parsing call   :', xmlDoc); //DUBUGGING
    console.log('XSD Doc in prepareValidationData after getXmlDoc call :', xsdDoc); //DEBUGGING
    console.log('typeof XSD Doc in prepareValidationData after getXmlDoc call :', typeof xsdDoc); //DEBUGGING

    return { xmlDoc, xsdDoc };
  } catch (error) {
    if (error instanceof Error) {
      console.error('Generic error in prepareValidationData:', error.message);
    } else {
      console.error('Unexpected error type:', error);
    }
    throw error; // Rethrow the error for handling in the calling function
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
}
//===============================================================================
  
function validateString(elementValue, simpleType, validationResults, element) {
    const { minLength, maxLength, pattern } = simpleType.restrictions || {};
    
    if (minLength !== undefined && elementValue.length < minLength) {
        validationResults.push({
        type: 'error',
        level: 2,
        message: `String length is less than minimum allowed length ${minLength}`,
        element: element,
        category: 'dataTypeValidationError'
        });
        return false;
    }
    
    if (maxLength !== undefined && elementValue.length > maxLength) {
        validationResults.push({
        type: 'error',
        level: 2,
        message: `String length exceeds maximum allowed length ${maxLength}`,
        element: element,
        category: 'dataTypeValidationError'
        });
        return false;
    }
    
    if (pattern !== undefined && !new RegExp(pattern).test(elementValue)) {
        validationResults.push({
        type: 'error',
        level: 2,
        message: `String does not match pattern ${pattern}`,
        element: element,
        category: 'dataTypeValidationError'
        });
        return false;
    }
    
    return true;
    }
    

//===============================================================================

function validateDecimal(elementValue, simpleType, validationResults, element) {
    const decimalValue = parseFloat(elementValue);
    
    if (isNaN(decimalValue)) {
        validationResults.push({
        type: 'error',
        level: 2,
        message: `Value '${elementValue}' is not a valid decimal number`,
        element: element,
        category: 'dataTypeValidationError'
        });
        return false;
    }
    
    const { totalDigits, fractionDigits } = simpleType.restrictions || {};
    
    if (totalDigits !== undefined) {
        const totalDigitsCount = elementValue.toString().length;
        if (totalDigitsCount > totalDigits) {
        validationResults.push({
            type: 'error',
            level: 2,
            message: `Decimal value exceeds maximum total digits ${totalDigits}`,
            element: element,
            category: 'dataTypeValidationError'
        });
        return false;
        }
    }
    
    if (fractionDigits !== undefined) {
        const decimalPart = elementValue.toString().split('.')[1] || '';
        if (decimalPart.length > fractionDigits) {
        validationResults.push({
            type: 'error',
            level: 2,
            message: `Decimal value exceeds maximum fraction digits ${fractionDigits}`,
            element: element,
            category: 'dataTypeValidationError'
        });
        return false;
        }
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
    const { minInclusive, maxInclusive, pattern } = simpleType.restrictions || {};

    if (minInclusive) {
      const minDate = parse(minInclusive, 'yyyy-MM-dd', new Date());
      if (parsedDate < minDate) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Date value ${elementValue} is before minimum allowed date ${minInclusive}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    if (maxInclusive) {
      const maxDate = parse(maxInclusive, 'yyyy-MM-dd', new Date());
      if (parsedDate > maxDate) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Date value ${elementValue} is after maximum allowed date ${maxInclusive}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    if (pattern) {
      const patternRegex = new RegExp(pattern);
      if (!patternRegex.test(elementValue)) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Date value does not match pattern ${pattern}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    return true;
}

//===============================================================================

function validateTime(elementValue, simpleType, validationResults, element) {
    const parsedTime = parse(elementValue, 'HH:mm:ss', new Date());
    if (!isValid(parsedDate)) {
      validationResults.push({
        type: 'error',
        level: 2,
        message: `Invalid time format: ${elementValue}`,
        element: element,
        category: 'dataTypeValidationError'
      });
      return false;
    }
  
    const { minInclusive, maxInclusive, pattern } = simpleType.restrictions || {};
  
    if (minInclusive) {
      const minTime = parse(minInclusive, 'HH:mm:ss', new Date());
      if (parsedTime < minTime) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Time value ${elementValue} is before minimum allowed time ${minInclusive}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    if (maxInclusive) {
      const maxTime = parse(maxInclusive, 'HH:mm:ss', new Date());
      if (parsedTime > maxTime) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Time value ${elementValue} is after maximum allowed time ${maxInclusive}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    if (pattern) {
      const patternRegex = new RegExp(pattern);
      if (!patternRegex.test(elementValue)) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Time value does not match pattern ${pattern}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    return true;
}
//===============================================================================
function validateDateTime(elementValue, simpleType, validationResults, element) {
    const parsedDateTime = parseISO(elementValue);
    if (!isValid(parsedDateTime)) {
      validationResults.push({
        type: 'error',
        level: 2,
        message: `Invalid dateTime format: ${elementValue}`,
        element: element,
        category: 'dataTypeValidationError'
      });
      return false;
    }
  
    const { minInclusive, maxInclusive, pattern } = simpleType.restrictions || {};
  
    if (minInclusive) {
      const minDateTime = parseISO(minInclusive);
      if (parsedDateTime < minDateTime) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `DateTime value ${elementValue} is before minimum allowed dateTime ${minInclusive}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    if (maxInclusive) {
      const maxDateTime = parseISO(maxInclusive);
      if (parsedDateTime > maxDateTime) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `DateTime value ${elementValue} is after maximum allowed dateTime ${maxInclusive}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
  
    if (pattern) {
      const patternRegex = new RegExp(pattern);
      if (!patternRegex.test(elementValue)) {
        validationResults.push({
          type: 'error',
          level: 2,
          message: `DateTime value does not match pattern ${pattern}`,
          element: element,
          category: 'dataTypeValidationError'
        });
        return false;
      }
    }
    return true;
}

//===============================================================================

function validateSimpleType(baseType, elementValue, validationResults) {
    switch (baseType) {
      case 'integer':
        return validateInteger(elementValue, validationResults);
      case 'string':
        return validateString(elementValue, validationResults);
      case 'decimal':
        return validateDecimal(elementValue, validationResults);
      case 'boolean':
        return validateBoolean(elementValue, validationResults);
      case 'date':
        return validateDate(elementValue, validationResults);
      case 'time':
        return validateTime(elementValue, validationResults);
      case 'dateTime':
        return validateDateTime(elementValue, validationResults);
      default:
        // Handle unknown base types
        validationResults.push({
          type: 'error',
          level: 2,
          message: `Unsupported base type: ${baseType}`,
          element: element, // Assuming element is available
          category: 'schemaValidationError'
        });
        return false;
    }
  }
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
  
    if (!simpleType) {
      validationResults.push({
        type: 'error',
        level: 2,
        message: `Simple type not found: ${simpleTypeName}`,
        element: element,
        category: 'schemaValidationError'
      });
      return false;
    }
  
    const elementValue = element.text();
  
    if (simpleType.base) {
      if (!validateSimpleType(simpleType.base, elementValue, validationResults)) {
        return false;
      }
    }
  
    // Additional facet-based validations
    if (simpleType.restrictions) {
      const { minInclusive, maxInclusive, minLength, maxLength, pattern } = simpleType.restrictions;
  
      if (minInclusive !== undefined && elementValue < minInclusive) {
        // Handle minimum value violation
        validationResults.push({
          // ... error details
        });
        return false;
      }
  
      if (maxInclusive !== undefined && elementValue > maxInclusive) {
        // Handle maximum value violation
        validationResults.push({
          // ... error details
        });
        return false;
      }
  
      // ... other facet validations ...
    }
    return true;
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

function handleAttribute(element, schemaData) {
  const attributeName = element.attr('name');
  const attributeType = element.attr('type');
  const defaultValue = element.attr('default');
  const use = element.attr('use');
  schemaData.attributes[attributeName] = { attributeType, defaultValue, use };
}
//===============================================================================

function traverse(element, elementOrderMap, elementHierarchy, schemaData, unknownElements, validationResults, validationContext) {
    if (!element || typeof element !== 'object') {
      console.error('Invalid element:', element);
      // Handle invalid element gracefully, e.g., return an empty result or log an error
      return {
        success: false,
        errors: [
          {
            type: 'error',
            level: 2,
            message: 'Invalid element type encountered',
            element: element, // If available
            category: 'traversalError'
          }
        ],
        validationSummary: {
          totalElements: 0,
          validElements: 0,
          errorCount: 0,
          // Add other summary properties as needed
        }
      };
    }
  
    if (element.name() !== 'element') {
      return {
        success: true,
        errors: [],
        validationSummary: {
          totalElements: 0,
          validElements: 0,
          errorCount: 0,
          // Add other summary properties as needed
        }
      };
    }
  
    const validationSummary = {
      totalElements: 0,
      validElements: 0,
      errorCount: 0,
      // Add other summary properties as needed
    };
  
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
  
      validationSummary.totalElements++;

  // ... validation logic for the current element
  if (isValid) {
    validationSummary.validElements++;
  } else {
    validationSummary.errorCount++;
  }

  // Recursively traverse child elements
  element.children().forEach(child => {
    const childResult = traverse(child, elementOrderMap, elementHierarchy, schemaData, unknownElements, validationResults, validationContext);
    validationSummary.totalElements += childResult.validationSummary.totalElements;
    validationSummary.validElements += childResult.validationSummary.validElements;
    validationSummary.errorCount += childResult.validationSummary.errorCount;
    // ... handle child result
  });

  return {
    success: !hasChildErrors,
    errors: childResults.flatMap(result => result.errors),
    validationSummary: validationSummary
  };
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

  console.log('Typeof XsdDoc in function extractElementOrderFromXsd is: ', typeof xsdDoc); //DEBUGGING
  console.log('XsdDoc in function extractElementOrderFromXsd is: ', xsdDoc); // DEBUGGING

  try {
    const ns = {
      xs: 'http://www.w3.org/2001/XMLSchema'
    };

    const sequenceElements = xsdDoc.find('/xs:schema/xs:element[@name="sequence"]/xs:sequence/xs:element', ns);

    sequenceElements.forEach(element => {
      const elementName = element.attr('name');
      const parentName = element.parent().parent().name(); // Assuming parent is a complexType

      if (!elementOrderMap[parentName]) {
        elementOrderMap[parentName] = [];
      }

      elementOrderMap[parentName].push(elementName);
    });

    return elementOrderMap;
  } catch (error) {
    console.error('Error extracting element order:', error);
    // Handle the error, e.g., log it, throw a custom error, or return a default value
          throw error; // Rethrow the exception
  }
}
//===============================================================================


// Helper Function for validateXML
function validateAgainstSchema(xmlDoc, xsdDoc) {
    const isValid = xmlDoc.validate(xsdDoc);
  
    if (!isValid) {
      const validationErrors = xmlDoc.validationErrors.map(error => {
        const element = xmlDoc.getElementsByTagName(error.nodeName)[0];
        const expectedType = xsdDoc.getElementsByTagName(error.nodeName)[0].getAttribute('type');
  
        const validationError = new ValidationError(`
          Element "${element.nodeName}" ist ungültig.
          Erwarteter Datentyp: "${expectedType}"
          Fehlermeldung: ${error.message}
        `);
        validationError.populateDetails({
          code: 'schemaValidationError',
          level: 'error',
          line: error.lineNumber,
          column: error.columnNumber,
          domain: 'validation',
          source: 'xsd',
          location: {
            element: element.nodeName,
            attribute: element.hasAttribute('id') ? 'id' : undefined, // Beispiel für Attribut-Information
            text: element.textContent, // Beispiel für Textinhalt
            line: error.lineNumber,
            column: error.columnNumber,
            file: 'unknown' // Kann aktualisiert werden
          }
        });
  
        validationError.details = {
          expectedType: expectedType
        };
  
        return validationError;
      });
      throw new SchemaValidationException('Schema validation failed', validationErrors);
    }
  
    return isValid;
}  
  //===============================================================================

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
//===============================================================================

// Helper Function for validateXML
function validateElementOrder(xmlDoc, elementOrderMap) {
  const rootElement = xmlDoc.root();
  const expectedOrder = elementOrderMap[rootElement.name()];
  if (expectedOrder && !validateElementOrderHelper(rootElement, expectedOrder)) {
    throw new ValidationError('Element order violation');
  }
}
//===============================================================================

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
//===============================================================================

// Refactored validateXML function
function validateXML(validationData) {
    const { xmlDoc, xsdDoc } = validationData;
    const validationResults = [];
  
    try {
      // Schema Validation
      const schemaValidationResult = {
        name: 'schemaValidation',
        isValid: true,
        errors: []
      };
      try {
        validateAgainstSchema(xmlDoc, xsdDoc);
      } catch (error) {
        schemaValidationResult.isValid = false;
        const formattedErrors = formatValidationErrors([error]);
        schemaValidationResult.errors.push(...formattedErrors);
        handleError(error);
      }
      validationResults.push(schemaValidationResult);
  
      // Custom Validation
      const customValidationResult = {
        name: 'customValidation',
        isValid: true,
        errors: []
      };
      try {
        validateCustomRules(xmlDoc);
      } catch (error) {
        customValidationResult.isValid = false;
        const formattedErrors = formatValidationErrors([error]);
        customValidationResult.errors.push(...formattedErrors);
        handleError(error);
      }
      validationResults.push(customValidationResult);
  
      // Element Order Validation
      const elementOrderValidationResult = {
        name: 'elementOrderValidation',
        isValid: true,
        errors: []
      };
      try {
        const elementOrderMap = extractElementOrderFromXsd(xsdDoc);
        validateElementOrder(xmlDoc, elementOrderMap);
      } catch (error) {
        elementOrderValidationResult.isValid = false;
        const formattedErrors = formatValidationErrors([error]);
        elementOrderValidationResult.errors.push(...formattedErrors);
        handleError(error);
      }
      validationResults.push(elementOrderValidationResult);
  
    } catch (error) {
      // Handle unexpected errors
      handleError(error);
      throw error;
    }
  
    // Determine overall success
    const overallSuccess = validationResults.every(result => result.isValid);
  
    return {
      isValid: overallSuccess,
      results: validationResults
    };
}
// =======================================================

// Function to format validation errors for logging in handleError
function formatValidationErrors(errors) {
    return errors.map(error => {
      let message;
  
      switch (error.code) {
        case 'schemaValidationError':
          message = `Schema validation error at line ${error.location.line}, column ${error.location.column}:`;
          if (error.details.expectedType) {
            message += ` Expected type '${error.details.expectedType}' for element '${error.location.element}'.`;
          } else {
            message += ` Invalid value for element '${error.location.element}'.`;
          }
          break;
        case 'customValidationError': // Add custom message based on your rules
          message = `Custom validation error: ${error.message}`;
          break;
        case 'elementOrderError': // Add custom message based on your logic
          message = `Element order error: Expected elements in a different order.`;
          break;
        default:
          message = `Unknown error: ${error.message}`;
      }
  
      return {
        ...error,
        message
      };
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

function generateOutput(validationErrors, outputFormat = 'json') {
    try {
      if (!Array.isArray(validationErrors)) {
        throw new TypeError('Invalid validationErrors: Expected an array');
      }
  
      console.log('FROM: generateOutput - validationErrors:', validationErrors);
  
      const groupedErrors = {};
  
      validationErrors.forEach((error, index) => {
        try {
          console.log(`FROM: generateOutput - Processing error ${index + 1}:`, error);
  
          const errorType = error.errorType || 'unknownError';
          const location = error.location ? `${error.location.file}:${error.location.line}:${error.location.column}` : 'unknownLocation';
  
          const groupKey = `${errorType}-${location}`;
          if (!groupedErrors[groupKey]) {
            groupedErrors[groupKey] = {
              count: 0,
              errors: []
            };
          }
          groupedErrors[groupKey].count++;
          groupedErrors[groupKey].errors.push(error);
        } catch (error) {
          console.error('FROM: generateOutput - Error processing error:', error);
        }
      });
  
      console.log('FROM: generateOutput - Grouped errors:', groupedErrors);
  
      let output;
      switch (outputFormat) {
        case 'json':
          output = JSON.stringify(groupedErrors, null, 2);
          break;
        case 'text':
          // Implement specific logic for text output
          output = generateHumanReadableOutput(groupedErrors);
          break;
        // Add more cases for other output formats
        default:
          console.warn('FROM: generateOutput - Unsupported output format:', outputFormat);
          output = JSON.stringify(groupedErrors, null, 2);
      }
  
      return output;
    } catch (error) {
      console.error('FROM: generateOutput - Error generating output:', error);
      throw error; // Re-throw the error for further handling
    }
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

function generateErrorReport(validationResults, outputFormat) {
    const report = generateHumanReadableReport(validationResults);
  
    if (outputFormat === 'file') {
      fs.writeFileSync(outputFilePath, report);
    } else {
      console.log(report);
    }
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

function generateValidationSuccessReport(validationResults, xmlFilePath, xsdFilePath) {
    
    console.log('from generateValidationSuccessReport - Typeof validationResults: ', typeof validationResults); // DEBUGGING
    console.log('from generateValidationSuccessReport - validationResults:', validationResults); // DEBUGGING
    
    // Loop through validationResults to log individual elements
    validationResults.forEach((element, index) => {
        console.log(`Element ${index + 1}:`, element, 'Type = ', typeof element);
        console.log('  name:', element.name,'Type = ', typeof element.name);
        console.log('  isValid:', element.isValid,'Type = ', typeof element.isValid);
        console.log('  errors:', element.errors,'Type = ', typeof element.errors);
        console.log('---');
  });


    if (!Array.isArray(validationResults)) {
        console.error('FROM generateValidationSuccessReport - Invalid validationResults: Expected an array');
        return null; // Or handle the error differently
      }
    
      const reportData = {
        xmlFilePath,
        xsdFilePath,
        validationTime: new Date().toISOString(),
        status: 'success', // Initial assumption
        validationChecks: [],
        summary: {
          totalChecks: 0,
          successfulChecks: 0,
          failedChecks: 0
        }
      };
    
      // Check reportData type and required properties
    if (typeof reportData !== 'object') {
        console.error('FROM generateValidationSuccessReport - Invalid reportData: Expected an object');
        return null;
      } else {
        const requiredProperties = ['xmlFilePath', 'xsdFilePath', 'validationTime', 'status', 'validationChecks', 'summary'];
        const missingProperties = requiredProperties.filter(prop => !(prop in reportData));
        if (missingProperties.length > 0) {
          console.error(`FROM generateValidationSuccessReport - Missing required properties in reportData: ${missingProperties.join(', ')}`);
          return null;
        }
      }

    // Iterate over validation results and populate validation checks
    for (const checkName in validationResults) {
      const checkResult = validationResults[checkName];
      console.log('FROM generateValidationSuccessReport -  checkResult:', checkResult, ' Type = ',typeof checkResult); //DEBUGGING
      reportData.summary.totalChecks++;
      const detailedErrors = checkResult.errors.length > 0
        ? checkResult.errors.map(error => ({
            message: error.message,
            lineNumber: error.lineNumber || null,
            columnNumber: error.columnNumber || null,
            errorCode: error.type || 'unknownError', // Use error type if available
          }))
        : [];
  
      reportData.validationChecks.push({
        name: checkName,
        status: checkResult.isValid ? 'success' : 'failure',
        details: detailedErrors,
        startTime: checkResult.startTime || null,
        endTime: checkResult.endTime || null
      });
  
      reportData.summary[checkResult.isValid ? 'successfulChecks' : 'failedChecks']++;
  
      // Update overall status if any check fails
      if (!checkResult.isValid) {
        reportData.status = 'failure';
      }
    }
  
    // Generate output based on desired format
    const outputFormat = 'json'; // Replace with desired format (e.g., 'xml', 'csv')
    // const report = generateOutput(reportData, outputFormat);
    const report = generateOutput(validationResults, outputFormat);
  
    // Handle the report
    console.log(report); // For console output
    fs.writeFileSync('./FW_test_logs/validation_success.txt', report); // For file output
  
    return reportData; // Optionally return the report data
}
  
  //==============================END FUNKTION BLOCK=================================================
//-------------------------------------------------------------------------------------------------
//==========================M A I N  _  F u n k t i o n============================================

async function main() {
    try {
      const directory = './xmlxsddata';
  
      const { xmlFiles, xsdFiles } = await listFiles(directory);
      if (xmlFiles.length === 0 || xsdFiles.length === 0) {
        console.error('No XML or XSD files found in the directory.');
        return;
      }
  
      let continueValidation = true;
      while (continueValidation) {
        console.log('Available XML files:');
        xmlFiles.forEach((file, index) => {
          console.log(`${index + 1}. ${file}`);
        });
  
        console.log('\nAvailable XSD files:');
        xsdFiles.forEach((file, index) => {
          console.log(`${index + 1}. ${file}`);
        });
  
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
  
        const xmlFilePath = path.join(directory, xmlFiles[xmlIndex].trim());
        const xsdFilePath = path.join(directory, xsdFiles[xsdIndex].trim());
  
        try {
          const xmlString = await readFileContent(xmlFilePath);
          const xsdString = await readFileContent(xsdFilePath);
  
          const xmlDoc = parseXml(xmlString);
          const xsdDoc = parseXsd(xsdString);
  
          const validationData = {
            xmlDoc,
            xsdDoc
          };
  
          const validationResult = validateXML(validationData);
  
          console.log('main-function: validationResult.isValid = ', validationResult.isValid); // DEBUGGING
  
          if (validationResult.isValid) {
            console.log('XML document ', xmlFilePath, green + ' is valid' + reset);
            const validationSuccessReport = generateValidationSuccessReport(validationResult.results, xmlFilePath, xsdFilePath, isValid);
            console.log('Validation success report:', validationSuccessReport);
          } else {
            console.error('XML document', xmlFilePath, 'is invalid');
  
            // Handle validation errors based on validationResults
            for (const validationType in validationResult.results) {
              const validationErrors = validationResult.results[validationType]?.errors || [];
              if (validationErrors.length > 0) {
                console.error('Errors for ${validationType}:');
                for (const error of validationErrors) {
                  console.error(`  - ${error.message}`, error.lineNumber || '', error.columnNumber || '');
                }
              }
            }
          }
        } catch (innerErr) {
          console.error('An unexpected error occurred:', innerErr);
          // Handle specific error types if needed
        } 
        // After validation, ask the user if they want to continue
        const continueInput = await getUserInput('Do you want to validate another XML file? (y/n): ');
        continueValidation = continueInput.toLowerCase() === 'y';
      }
    } finally {
      readline.close();
    }
}
 // END MAIN-FUNCTION


// Call main function
main();