// configure theRoom
window.theRoom.configure({
  blockRedirection: true,
  createInspector: true,
  excludes: [],
  click: function (element, event) {
    event.preventDefault()
    const json = window.htmlToFigma(getSelector(element));
    navigator
      .clipboard
      .writeText(
        "{\"layers\": " + JSON.stringify(json) + "}"
      )
      .then(
        function () {
          alert('The JSON selector has successfully copied to clipboard!')
        },
        function (err) {
          alert('The JSON selector could not be copied to clipboard!')
        }
      )
    window.theRoom.stop(true)
  }
})

// Inspector element styles
var linkElement = document.createElement('link')
linkElement.setAttribute('rel', 'stylesheet')
linkElement.setAttribute('type', 'text/css')
linkElement.setAttribute('href', 'data:text/css;charset=UTF-8,' + encodeURIComponent('.inspector-element { position: absolute; pointer-events: none; border: 2px dashed rgba(28, 151, 204, 1); transition: all 200ms; background-color: rgba(28, 151, 204, 0.5); }'))
document.head.appendChild(linkElement)

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  window.theRoom.start()
})
