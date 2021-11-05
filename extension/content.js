window.theRoom.configure({
  blockRedirection: true,
  createInspector: true,
  excludes: [],
  click(element, event) {
    event.preventDefault();
    const json = window.htmlToFigma(getSelector(element));
    navigator
      .clipboard
      .writeText(
        `{"layers": ${JSON.stringify(json)}}`,
      )
      .then(
        () => {
          alert('The JSON selector has successfully copied to clipboard!');
        },
        (err) => {
          alert('The JSON selector could not be copied to clipboard!');
        },
      );
    window.theRoom.stop(true);
  },
});

// Inspector element styles
const linkElement = document.createElement('link');
linkElement.setAttribute('rel', 'stylesheet');
linkElement.setAttribute('type', 'text/css');
linkElement.setAttribute('href', `data:text/css;charset=UTF-8,${encodeURIComponent('body { cursor: pointer !important; } .inspector-element {  position: absolute; pointer-events: none; border: 2px dashed rgba(28, 151, 204, 1); transition: all 200ms; background-color: rgba(28, 151, 204, 0.5); }')}`);
document.head.appendChild(linkElement);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  window.theRoom.start();
});
