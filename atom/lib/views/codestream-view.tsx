import { shell } from "electron";
import { CompositeDisposable, Emitter, TextEditor, Range, Point } from "atom";
import { WorkspaceSession, SessionStatus } from "../workspace/workspace-session";
import { LoginResult } from "../protocols/agent/api.protocol";
import {
	GetFileStreamRequestType,
	DidChangeDataNotificationType,
} from "../protocols/agent/agent.protocol";
import {
	WebviewIpcMessage,
	BootstrapRequestType,
	SignedInBootstrapResponse,
	SlackLoginRequestType,
	SlackLoginResponse,
	CompleteSignupRequestType,
	WebviewDidInitializeNotificationType,
	HostDidLogoutNotificationType,
	LoginRequestType,
	LoginRequest,
	isIpcRequestMessage,
	HostDidChangeActiveEditorNotificationType,
	HostDidChangeActiveEditorNotification,
	WebviewIpcNotificationMessage,
	WebviewIpcRequestMessage,
	UpdateConfigurationRequestType,
	WebviewDidChangeContextNotificationType,
	HostDidChangeConfigNotificationType,
	UpdateConfigurationRequest,
	UpdateConfigurationResponse,
	ShowStreamNotificationType,
} from "@codestream/protocols/webview";
import { asAbsolutePath } from "../utils";
import { getStyles } from "./styles-getter";
import { NotificationType } from "vscode-languageserver-protocol";
import { Convert } from "atom-languageclient";

export class WebviewIpc {
	private channel: MessageChannel;

	constructor() {
		this.channel = new MessageChannel();
	}

	get host() {
		return this.channel.port1;
	}

	get webview() {
		return this.channel.port2;
	}
}

export const CODESTREAM_VIEW_URI = "atom://codestream";
export const WEBVIEW_DID_INITIALIZE = "webview-ready";
export const WILL_DESTROY = "will-destroy";

export class CodestreamView {
	alive = false;
	element: HTMLElement;
	private session: WorkspaceSession;
	private subscriptions: CompositeDisposable;
	private channel: WebviewIpc;
	private iframe: HTMLIFrameElement;
	private loadingSpinner: HTMLDivElement;
	private emitter: Emitter;
	private webviewReady?: Promise<void>;
	private webviewContext?: any;

	constructor(session: WorkspaceSession, webviewContext?: any) {
		this.session = session;
		this.webviewContext = webviewContext;
		this.channel = new WebviewIpc();
		this.emitter = new Emitter();
		this.alive = true;
		this.subscriptions = new CompositeDisposable();
		this.element = document.createElement("div");
		this.element.classList.add("codestream", "preload");
		this.iframe = document.createElement("iframe");
		this.loadingSpinner = this.setupLoadingSpinner();

		this.initializeWebview(this.iframe);
		this.initialize();
		this.setupWebviewListener();
	}

	// update-able
	getTitle() {
		return "CodeStream";
	}

	// update-able
	getIconName() {
		return "comment-discussion";
	}

	getDefaultLocation() {
		return "right";
	}

	getAllowedLocations() {
		return ["right", "left"];
	}

	isPermanentDockItem() {
		return false;
	}

	getPreferredWidth() {
		// save this as a preference?
		return 300;
	}

	getURI() {
		return CODESTREAM_VIEW_URI;
	}

	async show(streamId?: string, threadId?: string) {
		await atom.workspace.open(this, { activatePane: true });
		if (streamId) {
			await this.webviewReady;
			this.sendEvent(ShowStreamNotificationType, { streamId, threadId });
		}
	}

	private setupLoadingSpinner() {
		const loaderRing = document.createElement("div");
		loaderRing.innerHTML = `
			<div class="loader-ring">
				<div class="loader-ring__segment"></div>
				<div class="loader-ring__segment"></div>
				<div class="loader-ring__segment"></div>
				<div class="loader-ring__segment"></div>
			</div>
		`;
		this.element.appendChild(loaderRing);

		return loaderRing;
	}

	private removeLoadingSpinner() {
		this.element.removeChild(this.loadingSpinner);
	}

	private initializeWebview(iframe: HTMLIFrameElement) {
		iframe.height = "100%";
		iframe.width = "100%";
		iframe.style.border = "none";
		iframe.src = asAbsolutePath("dist/webview/index.html");

		iframe.classList.add("webview");
		iframe.addEventListener("load", () => {
			this.iframe.contentWindow!.postMessage(
				{
					label: "codestream-webview-initialize",
					styles: getStyles(),
				},
				"*",
				[this.channel.webview]
			);
		});

		this.iframe = iframe;
		this.element.append(iframe);
	}

	private initialize() {
		// TODO?: create a controller to house this stuff so it isn't re-init everytime this view is instantiated
		this.subscriptions.add(
			this.session.agent.onInitialized(() => {
				this.subscriptions.add(
					this.session.agent.onDidChangeData(data =>
						this.sendEvent(DidChangeDataNotificationType, data)
					)
				);
			}),
			this.session.onDidChangeSessionStatus(status => {
				if (status === SessionStatus.SignedOut) {
					this.sendEvent(HostDidLogoutNotificationType, {});
				}
			}),
			this.session.configManager.onDidChangeWebviewConfig(changes =>
				this.sendEvent(HostDidChangeConfigNotificationType, changes)
			)
		);

		this.webviewReady = new Promise(resolve =>
			this.subscriptions.add(
				this.emitter.on(WEBVIEW_DID_INITIALIZE, () => {
					resolve();
					atom.workspace.observeActiveTextEditor(async (editor?: TextEditor) => {
						if (editor && editor.getPath()) {
							const filePath = editor.getPath()!;
							const uri = Convert.pathToUri(filePath);
							const { stream } = await this.session.agent.request(GetFileStreamRequestType, {
								textDocument: { uri },
							});

							// TODO: check range for folds and send ALL visible ranges
							const [startPoint, endPoint] = (editor as any)
								.getVisibleRowRange()
								.map(line => new Point(line));

							const { start, end } = Convert.atomRangeToLSRange(new Range(startPoint, endPoint));
							// const event: HostDidChangeActiveEditorNotification = {
							// 	editor: {
							// 		fileName: atom.project.relativize(filePath)!,
							// 		visibleRanges: [[start, end]] as any,
							// 		uri,
							// 	},
							// };
							// this.sendEvent(HostDidChangeActiveEditorNotificationType, event);
						}
					});
				})
			)
		);
	}

	serialize() {
		return {
			deserializer: "codestream/CodestreamView",
		};
	}

	destroy() {
		this.emitter.emit(WILL_DESTROY, this.webviewContext);
		this.element.remove();
		this.alive = false;
		this.subscriptions.dispose();
	}

	onWillDestroy(cb: (data: any) => void) {
		return this.emitter.on(WILL_DESTROY, cb);
	}

	private setupWebviewListener() {
		this.channel.host.onmessage = ({ data }: { data: WebviewIpcMessage }) => {
			if (isIpcRequestMessage(data)) {
				const target = data.method.split("/")[0];
				if (target === "codeStream") return this.forwardWebviewRequest(data as any);
				return this.handleWebviewCommand(data);
			} else this.onWebviewNotification(data as WebviewIpcNotificationMessage);
		};
	}

	private async forwardWebviewRequest(request: { id: string; method: string; params?: any }) {
		const response = await this.session.agent.sendRequest(request.method, request.params);
		this.respond({ id: request.id, params: response });
	}

	private async handleWebviewCommand(message: WebviewIpcRequestMessage) {
		switch (message.method) {
			case BootstrapRequestType.method: {
				try {
					const data: SignedInBootstrapResponse = await this.session.getBootstrapData();
					this.respond<SignedInBootstrapResponse>({
						id: message.id,
						params: { ...data, context: { ...data.context, ...(this.webviewContext || {}) } },
					});
				} catch (error) {
					this.respond({ id: message.id, error: error.message });
				}
				break;
			}
			case SlackLoginRequestType.method: {
				const ok = shell.openExternal(
					`${
						this.session.environment.webAppUrl
					}/service-auth/slack?state=${this.session.getSignupToken()}`
				);
				if (ok) this.respond<SlackLoginResponse>({ id: message.id, params: true });
				else {
					this.respond({
						id: message.id,
						error: "No app found to open url",
					});
				}
				break;
			}
			case CompleteSignupRequestType.method: {
				const status = await this.session.loginViaSignupToken(message.params);
				if (status !== LoginResult.Success) this.respond({ id: message.id, error: status });
				else {
					const data = await this.session.getBootstrapData();
					this.respond<SignedInBootstrapResponse>({ id: message.id, params: data });
				}
				break;
			}
			case LoginRequestType.method: {
				const params: LoginRequest = message.params;
				const status = await this.session.login(params.email, params.password);
				if (status !== LoginResult.Success) this.respond({ id: message.id, error: status });
				else {
					const data = await this.session.getBootstrapData();
					this.respond<SignedInBootstrapResponse>({ id: message.id, params: data });
				}
				break;
			}
			case UpdateConfigurationRequestType.method: {
				const { name, value }: UpdateConfigurationRequest = message.params;
				this.session.configManager.set(name as any, value);
				this.respond<UpdateConfigurationResponse>({ id: message.id, params: {} });
				break;
			}
			// case ReloadWebviewRequestType.method: {
			// 	new Promise(() => {
			// 		this.destroy();
			// 		atom.commands.dispatch(document.querySelector("atom-workspace")!, "codestream:toggle");
			// 	});
			// 	break;
			// }
			default: {
				console.warn("unhandled webview message", message);
			}
		}
	}

	private onWebviewNotification(event: WebviewIpcNotificationMessage) {
		switch (event.method) {
			case WebviewDidInitializeNotificationType.method: {
				this.removeLoadingSpinner();
				this.emitter.emit(WEBVIEW_DID_INITIALIZE);
				break;
			}
			case WebviewDidChangeContextNotificationType.method: {
				this.webviewContext = event.params.context;
				break;
			}
		}
	}

	private respond<R = any>(message: { id: string; params: R } | { id: string; error: any }): void {
		this.channel.host.postMessage(message);
	}

	private sendEvent<ET extends NotificationType<any, any>>(
		eventType: ET,
		params: ET extends NotificationType<infer P, any> ? P : never
	) {
		this.channel.host.postMessage({ method: eventType.method, params });
	}
}
