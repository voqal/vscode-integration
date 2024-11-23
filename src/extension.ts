import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
const RECONNECT_INTERVAL = 5000;

let contextUpdaters: (() => Promise<void>)[] = [];

setInterval(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("Executing context updaters. Size: " + contextUpdaters.length);
        for (const contextUpdater of contextUpdaters) {
            await contextUpdater();
        }
    }
}, 500);

// noinspection JSUnusedGlobalSymbols
export function activate() {
    console.log('Voqal VS Code integration activated');
    initializeWebSocket();
}

function initializeWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("WebSocket is already connected.");
        return;
    }

    const configuration = vscode.workspace.getConfiguration('voqal');
    const websocketUrl = configuration.get<string>('websocketUrl') || 'ws://localhost:22171/integration/vscode';
    ws = new WebSocket(websocketUrl);

    ws.onopen = () => {
        console.log('Connected to Voqal');
    };

    ws.onmessage = async (message) => {
        try {
            const data = JSON.parse(message.data as string);

            if (data.type && data.type == "javascript") {
                const payload = data.payload;
                try {
                    ws?.send(JSON.stringify({
                        ...await eval(`(async () => {
                            ${payload}
                        })()`),
                        replyTo: data.replyTo
                    }));
                } catch (error) {
                    console.error('Error executing JavaScript:', error);
                    ws?.send(JSON.stringify({
                        status: 'error',
                        message: 'Error executing JavaScript',
                        replyTo: data.replyTo
                    }));
                }
            } else if (data.type && data.type == "context_updater") {
                console.log("Adding context updater: " + data.name);
                const contextLibrary = data.library;
                const contextUpdaterName = data.name
                const contextUpdater = async function () {
                    const payload = data.payload;
                    try {
                        ws?.send(JSON.stringify({
                            ...await eval(`(async () => {
                                ${payload}
                            })()`),
                            type: 'context_update',
                            context: 'library',
                            name: contextUpdaterName,
                            library: contextLibrary
                        }));
                    } catch (error) {
                        console.error('Error executing JavaScript:', error);
                        ws?.send(JSON.stringify({
                            status: 'error',
                            message: 'Error executing JavaScript',
                            replyTo: data.replyTo
                        }));
                    }
                };
                contextUpdaters.push(contextUpdater);

                const resp = {
                    result: {
                        status: 'success'
                    },
                    replyTo: data.replyTo
                };
                ws?.send(JSON.stringify(resp));
            } else {
                console.error('Unknown event:', JSON.stringify(data));
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed. Attempting to reconnect...');
        ws = null;
        contextUpdaters = [];
        setTimeout(initializeWebSocket, RECONNECT_INTERVAL);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}
