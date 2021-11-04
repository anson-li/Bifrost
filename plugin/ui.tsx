import { BuilderElement } from "@builder.io/sdk";
import {
  Button,
  CircularProgress,
  createMuiTheme,
  CssBaseline,
  Divider,
  FormControlLabel,
  IconButton,
  MuiThemeProvider,
  Switch,
  TextField,
  Tooltip,
  Typography,
  Select,
  MenuItem,
  withStyles,
} from "@material-ui/core";
import green from "@material-ui/core/colors/green";
import Favorite from "@material-ui/icons/Favorite";
import * as fileType from "file-type";
import { action, computed, observable, when } from "mobx";
import { observer } from "mobx-react";
import * as pako from "pako";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as md5 from "spark-md5";
import * as traverse from "traverse";
import { arrayBufferToBase64 } from "../lib/functions/buffer-to-base64";
import { SafeComponent } from "./classes/safe-component";
import { settings } from "./constants/settings";
import { theme as themeVars } from "./constants/theme";
import { fastClone } from "./functions/fast-clone";
import { traverseLayers } from "./functions/traverse-layers";
import "./ui.css";
import { FormattedMessage } from "react-intl";

// Simple debug flag - flip when needed locally
const useDev = false;

const apiHost = useDev ? "http://localhost:5000" : "https://builder.io";

const selectionToBuilder = async (
  selection: SceneNode[]
): Promise<BuilderElement[]> => {
  const useGzip = true;

  selection = fastClone(selection);

  traverse(selection).forEach(function (item) {
    if (this.key === "intArr") {
      this.delete();
    }
  });

  const res = await fetch(`${apiHost}/api/v1/figma-to-builder`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(
      useGzip
        ? {
            compressedNodes: pako.deflate(JSON.stringify(selection), {
              to: "string",
            }),
          }
        : {
            nodes: selection,
          }
    ),
  }).then((res) => {
    if (!res.ok) {
      console.error("Figma-to-builder request failed", res);
      throw new Error("Figma-to-builder request failed");
    }
    return res.json();
  });
  return res.blocks;
};

interface ClientStorage {
  imageUrlsByHash: { [hash: string]: string | null } | undefined;
}

const apiKey = process.env.API_KEY || null;
const apiRoot =
  process.env.API_ROOT && process.env.NODE_ENV !== "production"
    ? process.env.API_ROOT
    : "https://builder.io";

const WIDTH_LS_KEY = "builder.widthSetting";
const FRAMES_LS_KEY = "builder.useFramesSetting";

// TODO: make async and use figma.clientStorage
function lsGet(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key)!);
  } catch (err) {
    return undefined;
  }
}
function lsSet(key: string, value: any) {
  try {
    return localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    return undefined;
  }
}

const clamp = (num: number, min: number, max: number) =>
  Math.max(min, Math.min(max, num));

type Node = TextNode | RectangleNode;

const theme = createMuiTheme({
  typography: themeVars.typography,
  palette: {
    primary: { main: themeVars.colors.primary },
    secondary: green,
  },
});

const StyledButton = withStyles({
  root: {
    fontSize: "12px",
    padding: "8px",
    height: "30px",
    minHeight: "unset",
    display: "flex",
    justifyContent: "center",
  },
})(MenuItem);

const BASE64_MARKER = ";base64,";
function convertDataURIToBinary(dataURI: string) {
  const base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
  const base64 = dataURI.substring(base64Index);
  const raw = window.atob(base64);
  const rawLength = raw.length;
  const array = new Uint8Array(new ArrayBuffer(rawLength));

  for (let i = 0; i < rawLength; i++) {
    array[i] = raw.charCodeAt(i);
  }
  return array;
}

function getImageFills(layer: Node) {
  const images =
    Array.isArray(layer.fills) &&
    layer.fills.filter((item) => item.type === "IMAGE");
  return images;
}

// TODO: CACHE!
// const imageCache: { [key: string]: Uint8Array | undefined } = {};
async function processImages(layer: Node) {
  const images = getImageFills(layer);

  const convertToSvg = (value: string) => {
    (layer as any).type = "SVG";
    (layer as any).svg = value;
    if (typeof layer.fills !== "symbol") {
      layer.fills = layer.fills.filter((item) => item.type !== "IMAGE");
    }
  };
  return images
    ? Promise.all(
        images.map(async (image: any) => {
          try {
            if (image) {
              const url = image.url;
              if (url.startsWith("data:")) {
                const type = url.split(/[:,;]/)[1];
                if (type.includes("svg")) {
                  const svgValue = decodeURIComponent(url.split(",")[1]);
                  convertToSvg(svgValue);
                  return Promise.resolve();
                } else {
                  if (url.includes(BASE64_MARKER)) {
                    image.intArr = convertDataURIToBinary(url);
                    delete image.url;
                  } else {
                    console.info(
                      "Found data url that could not be converted",
                      url
                    );
                  }
                  return;
                }
              }

              const isSvg = url.endsWith(".svg");

              // Proxy returned content through Builder so we can access cross origin for
              // pulling in photos, etc
              const res = await fetch(
                "https://builder.io/api/v1/proxy-api?url=" +
                  encodeURIComponent(url)
              );

              const contentType = res.headers.get("content-type");
              if (isSvg || (contentType && contentType.includes("svg"))) {
                const text = await res.text();
                convertToSvg(text);
              } else {
                const arrayBuffer = await res.arrayBuffer();
                const type = fileType(arrayBuffer);
                if (
                  type &&
                  (type.ext.includes("svg") || type.mime.includes("svg"))
                ) {
                  convertToSvg(await res.text());
                  return;
                } else {
                  const intArr = new Uint8Array(arrayBuffer);
                  delete image.url;
                  image.intArr = intArr;
                }
              }
            }
          } catch (err) {
            console.warn("Could not fetch image", layer, err);
          }
        })
      )
    : Promise.resolve([]);
}

export type Component = "row" | "stack" | "absolute";

export type SizeType = "shrink" | "expand" | "fixed";

export const sizeTypes: SizeType[] = ["expand", "shrink", "fixed"];

const invalidOptionString = "...";
type InvalidComponentOption = typeof invalidOptionString;

@observer
class App extends SafeComponent {
  editorRef: HTMLIFrameElement | null = null;

  @observable loading = false;
  // TODO: lsget/set?
  @observable lipsum = false; //  process.env.NODE_ENV !== "production";
  @observable loadingGenerate = false;
  @observable apiRoot = apiRoot;
  @observable clientStorage: ClientStorage | null = null;
  @observable errorMessage = "";

  @observable generatingCode = false;
  @observable urlValue = "https://www.builder.io";
  @observable width = lsGet(WIDTH_LS_KEY) || "1200";
  @observable online = navigator.onLine;
  @observable useFrames = lsGet(FRAMES_LS_KEY) || false;
  @observable showMoreOptions = true; // lsGet(MORE_OPTIONS_LS_KEY) || false;
  @observable selection: (BaseNode & { data?: { [key: string]: any } })[] = [];
  @observable.ref selectionWithImages:
    | (BaseNode & {
        data?: { [key: string]: any };
      })[]
    | null = null;

  @observable commandKeyDown = false;
  @observable shiftKeyDown = false;
  @observable altKeyDown = false;
  @observable ctrlKeyDown = false;
  @observable showRequestFailedError = false;
  @observable showImportInvalidError = false;
  @observable isValidImport: null | boolean = null;
  @observable.ref previewData: any;
  @observable displayFiddleUrl = "";
  @observable currentLanguage = "en";

  editorScriptAdded = false;
  dataToPost: any;

  async getImageUrl(
    intArr: Uint8Array,
    imageHash?: string
  ): Promise<string | null> {
    let hash = imageHash;
    if (!hash) {
      hash = md5.ArrayBuffer.hash(intArr);
    }
    const fromCache =
      hash &&
      this.clientStorage &&
      this.clientStorage.imageUrlsByHash &&
      this.clientStorage.imageUrlsByHash[hash];

    if (fromCache) {
      console.debug("Used URL from cache", fromCache);
      return fromCache;
    }
    if (!apiKey) {
      console.warn("Tried to upload image without API key");
      return null;
    }

    return fetch(`${apiRoot}/api/v1/upload?apiKey=${apiKey}`, {
      method: "POST",
      body: JSON.stringify({
        image: arrayBufferToBase64(intArr),
      }),
      headers: {
        "content-type": "application/json",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        const { url } = data;
        if (typeof url !== "string") {
          return null;
        }
        if (this.clientStorage && hash) {
          if (!this.clientStorage.imageUrlsByHash) {
            this.clientStorage.imageUrlsByHash = {};
          }
          this.clientStorage.imageUrlsByHash[hash] = url;
        }

        return url;
      });
  }

  getDataForSelection(name: string, multipleValuesResponse = null) {
    if (!this.selection.length) {
      return multipleValuesResponse;
    }
    const firstNode = this.selection[0];
    let value = firstNode.data && firstNode.data[name];
    for (const item of this.selection.slice(1)) {
      const itemValue = item.data && item.data[name];
      if (itemValue !== value) {
        return multipleValuesResponse;
      }
    }
    return value;
  }

  async updateStorage() {
    await when(() => !!this.clientStorage);
    parent.postMessage(
      {
        pluginMessage: {
          type: "setStorage",
          data: fastClone(this.clientStorage),
        },
      },
      "*"
    );
  }

  setDataForSelection(name: string, value: any) {
    for (const node of this.selection) {
      if (!node.data) {
        node.data = {
          [name]: value,
        };
      } else {
        node.data[name] = value;
      }
    }
    // TODO: throttleNextTick
    this.saveUpdates();
  }

  form: HTMLFormElement | null = null;
  urlInputRef: HTMLInputElement | null = null;
  iframeRef: HTMLIFrameElement | null = null;

  @computed get urlValid() {
    function validURL(str: string) {
      var pattern = new RegExp(
        "^(https?:\\/\\/)?" + // protocol
          "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
          "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
          "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
          "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
          "(\\#[-a-z\\d_]*)?$",
        "i"
      ); // fragment locator
      return !!pattern.test(str);
    }

    return validURL(this.urlValue);
  }

  @action
  updateKeyPositions(event: KeyboardEvent) {
    this.commandKeyDown = event.metaKey;
    this.altKeyDown = event.altKey;
    this.shiftKeyDown = event.shiftKey;
    this.ctrlKeyDown = event.ctrlKey;
  }

  @action
  async getCode(useFiddle = false) {
    this.displayFiddleUrl = "";
    this.showImportInvalidError = false;
    this.showRequestFailedError = false;
    if (!this.lipsum) {
      this.selectionWithImages = null;
      parent.postMessage(
        {
          pluginMessage: {
            type: "getSelectionWithImages",
          },
        },
        "*"
      );

      this.generatingCode = true;

      await when(() => !!this.selectionWithImages);
    } else {
      this.selectionWithImages = this.selection;
    }

    if (!(this.selectionWithImages && this.selectionWithImages[0])) {
      console.warn("No selection with images");
      return;
    }

    // TODO: analyze if page is properly nested and annotated, if not
    // suggest in the UI what needs grouping
    const selectionToBuilderPromise = selectionToBuilder(
      this.selectionWithImages as any
    ).catch((err) => {
      this.loadingGenerate = false;
      this.generatingCode = false;
      this.showRequestFailedError = true;
      throw err;
    });

    const imagesPromises: Promise<any>[] = [];
    const imageMap: { [key: string]: string } = {};
    for (const layer of this.selectionWithImages as SceneNode[]) {
      traverseLayers(layer, (node) => {
        const imageFills = getImageFills(node as Node);
        const image = imageFills && imageFills[0];
        if ((image as any)?.intArr) {
          imagesPromises.push(
            (async () => {
              const { id } = await fetch(`${apiHost}/api/v1/stage-image`, {
                method: "POST",
                body: JSON.stringify({
                  image: arrayBufferToBase64((image as any).intArr),
                }),
                headers: {
                  "content-type": "application/json",
                },
              }).then((res) => {
                if (!res.ok) {
                  console.error("Image upload failed", res);
                  throw new Error("Image upload failed");
                }
                return res.json();
              });
              delete (node as any).intArr;
              imageMap[node.id] = id;
            })()
          );
        }
      });
    }

    const blocks = await selectionToBuilderPromise;
    await Promise.all(imagesPromises).catch((err) => {
      this.loadingGenerate = false;
      this.generatingCode = false;
      this.showRequestFailedError = true;
      throw err;
    });

    traverse(blocks).forEach((item) => {
      if (item?.["@type"] === "@builder.io/sdk:Element") {
        const image = imageMap[item.meta?.figmaLayerId];
        if (image) {
          const url = `https://cdn.builder.io/api/v1/image/assets%2FTEMP%2F${image}`;
          if (item.component?.options) {
            item.component.options.image = url;
          } else if (item.responsiveStyles?.large?.backgroundImage) {
            item.responsiveStyles.large.backgroundImage = `url("${url}")`;
          }
        }
      }
    });

    const data = {
      data: {
        blocks: blocks,
      },
    };

    this.isValidImport = null;
    parent.postMessage(
      {
        pluginMessage: {
          type: "checkIfCanGetCode",
        },
      },
      "*"
    );

    this.generatingCode = true;

    await when(() => typeof this.isValidImport === "boolean");
    if (!this.isValidImport) {
      this.generatingCode = false;
      this.isValidImport = null;
      this.showImportInvalidError = true;
      return;
    }
    this.isValidImport = null;

    const json = JSON.stringify(data);

    if (useFiddle) {
      const res = await fetch(apiHost + "/api/v1/fiddle", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: json,
      })
        .then((res) => {
          if (!res.ok) {
            console.error("Failed to create fiddle", res);
            throw new Error("Failed to create fiddle");
          }
          return res.json();
        })
        .catch((err) => {
          this.generatingCode = false;
          this.selectionWithImages = null;
          this.showRequestFailedError = true;

          throw err;
        });
      if (res.url) {
        open(res.url, "_blank");
        this.displayFiddleUrl = res.url;
      }
      this.generatingCode = false;
      this.selectionWithImages = null;
    } else {
      const blob = new Blob([json], {
        type: "application/json",
      });

      const link = document.createElement("a");
      link.setAttribute("href", URL.createObjectURL(blob));
      link.setAttribute("download", "page.builder.json");
      document.body.appendChild(link); // Required for FF

      link.click();
      document.body.removeChild(link);

      this.generatingCode = false;
      this.selectionWithImages = null;
    }
  }

  @observable initialized = false;

  componentDidMount() {
    window.addEventListener("message", (e) => {
      const { data: rawData, source } = e as MessageEvent;

      this.initialized = true;

      const data = rawData.pluginMessage;
      if (!data) {
        return;
      }
      if (data.type === "selectionChange") {
        this.selection = data.elements;
      }
      if (data.type === "selectionWithImages") {
        this.selectionWithImages = data.elements;
      }
      if (data.type === "canGetCode") {
        this.isValidImport = data.value;
      }
      if (data.type === "doneLoading") {
        this.loading = false;
      }
      if (data.type === "storage") {
        this.clientStorage = data.data || {};
      }
    });

    parent.postMessage(
      {
        pluginMessage: {
          type: "getStorage",
        },
      },
      "*"
    );
    parent.postMessage(
      {
        pluginMessage: {
          type: "init",
        },
      },
      "*"
    );

    // TODO: destroy on component unmount
    this.safeReaction(
      () => this.urlValue,
      () => (this.errorMessage = "")
    );
    this.selectAllUrlInputText();

    this.safeListenToEvent(window, "offline", () => (this.online = false));
    this.safeListenToEvent(window, "keydown", (e) => {
      this.updateKeyPositions(e as KeyboardEvent);
    });
    this.safeListenToEvent(window, "keyup", (e) => {
      this.updateKeyPositions(e as KeyboardEvent);
    });
    this.safeListenToEvent(window, "online", () => (this.online = true));

    this.safeReaction(
      () => this.clientStorage && fastClone(this.clientStorage),
      () => {
        if (this.clientStorage) {
          this.updateStorage();
        }
      }
    );
  }

  saveUpdates = () => {
    if (this.selection.length) {
      parent.postMessage(
        {
          pluginMessage: {
            type: "updateElements",
            elements: fastClone(this.selection),
          },
        },
        "*"
      );
    }
  };

  selectAllUrlInputText() {
    const input = this.urlInputRef;
    if (input) {
      input.setSelectionRange(0, input.value.length);
    }
  }

  render() {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
          alignItems: "stretch",
          height: "100%",
        }}
      >
        <div
          style={{
            padding: 15,
            fontSize: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              id="title"
              style={{
                display: "flex",
                alignItems: "center",
                fontWeight: "bold",
              }}
            >
              Import your JSON file here, and see it transform into Figma components for your library!
            </div>
          </div>

          {!this.initialized ? (
            <div>
              <div style={{ display: "flex", padding: 20 }}>
                <CircularProgress
                  size={30}
                  disableShrink
                  style={{ margin: "auto" }}
                />
              </div>
              <div
                id="initExport"
                style={{
                  textAlign: "center",
                  fontSize: 12,
                  opacity: 0.6,
                  fontStyle: "italic",
                }}
              >
                Initializing for export, this can take about a minute...
              </div>
            </div>
          ) : this.generatingCode ? (
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", padding: 20 }}>
                <CircularProgress
                  size={30}
                  disableShrink
                  style={{ margin: "auto" }}
                />
              </div>
              <Typography
                variant="caption"
                style={{
                  textAlign: "center",
                  marginTop: 10,
                  color: themeVars.colors.primaryLight,
                  marginBottom: -10,
                  fontStyle: "italic",
                }}
              >
                Processing...
                <br />
                This can take about a minute...
              </Typography>
            </div>
          ) : (
            <>
              {this.showImportInvalidError && (
                <div>
                  <div
                    style={{
                      color: "rgb(200, 0, 0)",
                      marginTop: 10,
                      marginBottom: 10,
                    }}
                  >
                    To import a layer, that layer and all children must use&nbsp;
                    <a
                      style={{
                        color: themeVars.colors.primary,
                      }}
                      href="https://help.figma.com/hc/en-us/articles/360040451373-Create-dynamic-designs-with-Auto-layout"
                      target="_blank"
                      rel="noopenner"
                    >
                      autolayout.
                    </a>
                  </div>
                  <div>
                    <Button
                      size="small"
                      href="https://www.builder.io/c/docs/import-from-figma"
                      target="_blank"
                      color="primary"
                      rel="noopenner"
                    >
                      Learn more
                    </Button>
                    <Button
                      size="small"
                      style={{ opacity: 0.5 }}
                      onClick={() => {
                        parent.postMessage(
                          {
                            pluginMessage: {
                              type: "clearErrors",
                              data: true,
                            },
                          },
                          "*"
                        );
                        this.showImportInvalidError = false;
                      }}
                    >
                      Clear errors
                    </Button>
                  </div>
                </div>
              )}
              {this.showRequestFailedError && (
                <div>
                  <div
                    style={{
                      color: "rgb(200, 0, 0)",
                      marginTop: 10,
                      marginBottom: 10,
                    }}
                  >
                    <FormattedMessage
                      id="errorMessage"
                      defaultMessage="Oh no, there was an error!"
                    />
                  </div>
                  <div>
                    <Button
                      size="small"
                      color="primary"
                      href="https://www.builder.io/c/docs/import-from-figma#troubleshooting"
                      target="_blank"
                      rel="noopenner"
                    >
                      Learn more
                    </Button>
                    <Button
                      size="small"
                      style={{ opacity: 0.5 }}
                      onClick={() => {
                        this.showRequestFailedError = false;
                      }}
                    >
                      Clear errors
                    </Button>
                  </div>
                </div>
              )}
              <a
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  document.body.appendChild(input);
                  input.style.visibility = "hidden";
                  input.click();

                  const onFocus = () => {
                    setTimeout(() => {
                      if (
                        input.parentElement &&
                        (!input.files || input.files.length === 0)
                      ) {
                        done();
                      }
                    }, 200);
                  };

                  const done = () => {
                    input.remove();
                    this.loading = false;
                    window.removeEventListener("focus", onFocus);
                  };

                  window.addEventListener("focus", onFocus);

                  // TODO: parse and upload images!
                  input.addEventListener("change", (event) => {
                    const file = (event.target as HTMLInputElement)
                      .files![0];
                    if (file) {
                      this.loading = true;
                      var reader = new FileReader();

                      // Closure to capture the file information.
                      reader.onload = (e) => {
                        const text = (e.target as any).result;
                        try {
                          const json = JSON.parse(text);
                          Promise.all(
                            json.layers.map(async (rootLayer: Node) => {
                              await traverseLayers(
                                rootLayer,
                                (layer: any) => {
                                  if (getImageFills(layer)) {
                                    return processImages(layer).catch(
                                      (err) => {
                                        console.warn(
                                          "Could not process image",
                                          err
                                        );
                                      }
                                    );
                                  }
                                }
                              );
                            })
                          )
                            .then(() => {
                              parent.postMessage(
                                {
                                  pluginMessage: {
                                    type: "import",
                                    data: json,
                                  },
                                },
                                "*"
                              );
                              setTimeout(() => {
                                done();
                              }, 1000);
                            })
                            .catch((err) => {
                              done();
                              console.error(err);
                              alert(err);
                            });
                        } catch (err) {
                          alert("File read error: " + err);
                          done();
                        }
                      };

                      reader.readAsText(file);
                    } else {
                      done();
                    }
                  });
                }}
                style={{
                  color: themeVars.colors.primary,
                  cursor: "pointer",
                }}
              >
                <Button
                  fullWidth
                  style={{ marginTop: 20 }}
                  variant="contained"
                  color="primary"
                >
                  Upload
                </Button>
              </a>
            </>
          )}
        </div>
        <div>
          <Divider />
          {useDev && (
            <div
              onClick={() => {
                lsSet("builder.env", "production");
              }}
              style={{
                padding: 10,
                color: "rgb(200, 0, 0)",
                textAlign: "center",
              }}
            >
              Using dev env. Click here to reset then reload the extension
            </div>
          )}
          <div style={{ marginTop: 20, textAlign: "center", color: "#666" }}>
            Made with&nbsp;
            <Favorite
              style={{
                color: "rgb(236, 55, 88)",
                fontSize: 16,
                marginTop: -2,
                verticalAlign: "middle",
              }}
            />
            &nbsp;by&nbsp;
            <a
              style={{ color: themeVars.colors.primary }}
              href="https://github.com/anson-li/figma-componentizer"
              target="_blank"
            >
              ATB Hackathon
            </a>
          </div>
        </div>
      </div>
    );
  }
}

ReactDOM.render(
  <MuiThemeProvider theme={theme}>
    <>
      <CssBaseline />
      <App />
    </>
  </MuiThemeProvider>,
  document.getElementById("react-page")
);
