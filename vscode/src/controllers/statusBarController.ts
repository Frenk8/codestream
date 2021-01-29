"use strict";
import {
	ConfigurationChangeEvent,
	Disposable,
	StatusBarAlignment,
	StatusBarItem,
	window
} from "vscode";
import {
	CodeStreamEnvironment,
	SessionStatus,
	SessionStatusChangedEvent,
	UnreadsChangedEvent
} from "../api/session";
import { configuration } from "../configuration";
import { Container } from "../container";

export class StatusBarController implements Disposable {
	private readonly _disposable: Disposable;
	private _enabledDisposable: Disposable | undefined;
	private _statusBarItem: StatusBarItem | undefined;

	constructor() {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			Container.session.onDidChangeSessionStatus(this.onSessionStatusChanged, this),
			Container.session.onDidChangeUnreads(this.onUnreadsChanged, this),
			Container.agent.onDidSetEnvironment(() => {
				this.updateStatusBar(Container.session.status);
			})
		);

		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this.clear();

		this._enabledDisposable && this._enabledDisposable.dispose();
		this._disposable && this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, configuration.name("showInStatusBar").value)) {
			const cfg = Container.config;

			if (this._enabledDisposable !== undefined) {
				this._enabledDisposable.dispose();
				this._enabledDisposable = undefined;
				this._statusBarItem = undefined;
			}

			if (cfg.showInStatusBar) {
				this._enabledDisposable = Disposable.from(
					Container.session.onDidChangeSessionStatus(this.onSessionStatusChanged, this),
					Container.session.onDidChangeUnreads(this.onUnreadsChanged, this),

					this.updateStatusBar(Container.session.status)
				);
			}
		}
	}

	private onUnreadsChanged(e: UnreadsChangedEvent) {
		this.updateStatusBar(e.session.status, e.unreads());
	}

	private async onSessionStatusChanged(e: SessionStatusChangedEvent) {
		const status = e.getStatus();
		if (status === SessionStatus.SignedIn) {
			this.updateStatusBar(status, e.unreads);
		} else {
			this.updateStatusBar(status);
		}
	}

	async clear() {
		if (this._statusBarItem !== undefined) {
			this._statusBarItem.hide();
		}
	}

	private updateStatusBar(
		status: SessionStatus,
		unreads: { totalMentions: number; totalUnreads: number } = { totalMentions: 0, totalUnreads: 0 }
	) {
		if (this._statusBarItem === undefined) {
			const rightAlign = Container.config.showInStatusBar === "right";
			this._statusBarItem = window.createStatusBarItem(
				rightAlign ? StatusBarAlignment.Right : StatusBarAlignment.Left,
				rightAlign ? -99 : 5
			);
		}

		let env;
		switch (Container.session.environment) {
			case CodeStreamEnvironment.Production:
			case CodeStreamEnvironment.Unknown:
				env = "";
				break;
			default:
				env = `${Container.session.environment.toUpperCase()}: `;
				break;
		}

		switch (status) {
			case SessionStatus.SigningOut:
				this._statusBarItem.text = ` $(sync~spin) ${env}Signing out... `;
				this._statusBarItem.command = undefined;
				this._statusBarItem.tooltip = "Tearing down CodeStream Agent, please wait";
				this._statusBarItem.color = undefined;
				break;
			case SessionStatus.SignedOut:
				this._statusBarItem.text = ` $(comment-discussion) ${env}CodeStream `;
				this._statusBarItem.command = "codestream.signIn";
				this._statusBarItem.tooltip = "Sign in to CodeStream...";
				this._statusBarItem.color = undefined;
				break;

			case SessionStatus.SigningIn:
				this._statusBarItem.text = ` $(sync~spin) ${env}Signing in... `;
				this._statusBarItem.command = undefined;
				this._statusBarItem.tooltip = "Signing in to CodeStream, please wait";
				this._statusBarItem.color = undefined;
				break;

			case SessionStatus.SignedIn:
				// let label = Container.session.user.name;
				let label = `CodeStream: ${Container.session.user.name}`;
				let tooltip = "Toggle CodeStream";
				if (!Container.session.hasSingleTeam()) {
					label += ` - ${Container.session.team.name}`;
				}
				if (unreads.totalMentions > 0) {
					label += ` (${unreads.totalMentions})`;
					tooltip += `\nYou have ${unreads.totalMentions} unread mention${
						unreads.totalMentions === 1 ? "" : "s"
					}`;
				} else if (unreads.totalUnreads > 0) {
					label += " \u00a0\u2022";
					tooltip += "\nYou have unread messages";
				}

				// const unreadsOnly = unreads.totalUnreads - unreads.totalMentions;
				// if (unreadsOnly > 0) {
				// 	tooltip += `\n${unreadsOnly} unread message${unreadsOnly === 1 ? "" : "s"}`;
				// }

				this._statusBarItem.text = ` $(comment-discussion) ${env}${label} `;
				this._statusBarItem.command = "github-enterprise.toggle";
				this._statusBarItem.tooltip = tooltip;
				break;
		}

		this._statusBarItem.show();

		return this._statusBarItem;
	}
}
