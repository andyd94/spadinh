// Specify the CSS class to target
const targetClass = "my-class";

// Specify the expected text value for the child element
const expectedValue = "Expected Text";

// Get all elements with the target class
const elements = document.getElementsByClassName(targetClass);

// Iterate through the elements and filter based on child element's text
Array.from(elements).forEach((element) => {
    const childElement = element.querySelector(".child-element");
    if (childElement && childElement.textContent !== expectedValue) {
        element.remove();
    }
});