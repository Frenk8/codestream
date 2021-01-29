import {
	PasswordLoginRequest,
	PasswordLoginRequestType,
	isLoginFailResponse,
	LoginSuccessResponse,
	BootstrapRequestType,
	TokenLoginRequestType,
	OtcLoginRequestType,
	TokenLoginRequest,
	ProviderTokenRequest,
	ProviderTokenRequestType
} from "@codestream/protocols/agent";
import { CodeStreamState } from "../store";
import { HostApi } from "../webview-api";
import { LoginResult } from "@codestream/protocols/api";
import {
	goToTeamCreation,
	goToSSOAuth,
	setContext,
	SupportedSSOProvider,
	goToSignup,
	goToLogin,
	goToSetPassword
} from "../store/context/actions";
import { GetActiveEditorContextRequestType } from "../ipc/host.protocol.editor";
import {
	BootstrapInHostRequestType,
	ConnectToIDEProviderRequestType,
	OpenUrlRequestType
} from "../ipc/host.protocol";
import { bootstrap } from "../store/actions";
import { logError } from "../logger";
import { ChatProviderAccess } from "../store/context/types";
import { emptyObject, uuid } from "../utils";
import { localStore } from "../utilities/storage";
import { setSession, setMaintenanceMode } from "../store/session/actions";

export enum SignupType {
	JoinTeam = "joinTeam",
	CreateTeam = "createTeam"
}

export interface SSOAuthInfo {
	fromSignup?: boolean;
	type?: SignupType;
	inviteCode?: string;
	hostUrl?: string;
	useIDEAuth?: boolean;
	gotError?: boolean;
	repoInfo?: {
		teamId: string;
		repoId: string;
		commitHash: string;
	};
}

const ProviderNames = {
	github: "GitHub"
};

export const startSSOSignin = (
	provider: SupportedSSOProvider,
	info?: SSOAuthInfo,
	access?: ChatProviderAccess
) => async (dispatch, getState: () => CodeStreamState) => {
	const { context, configs, session } = getState();
	if (access == undefined) {
		access = context.chatProviderAccess;
	}

	const query: { [key: string]: string } = {};
	if (!info || !info.fromSignup) {
		query.noSignup = "1";
	}
	if (session.otc) {
		query.signupToken = session.otc;
	}
	if (access === "strict") {
		query.access = "string";
	}
	if (info && info.inviteCode) {
		query.inviteCode = info.inviteCode;
	}
	if (info && info.repoInfo) {
		query.repoInfo = `${info.repoInfo.teamId}|${info.repoInfo.repoId}|${info.repoInfo.commitHash}`;
	}
	if (info && info.hostUrl) {
		query.hostUrl = info.hostUrl;
	}
	if (session.machineId) {
		query.machineId = session.machineId;
	}
	const queryString = Object.keys(query)
		.map(key => `${key}=${query[key]}`)
		.join("&");

	try {
		await HostApi.instance.send(OpenUrlRequestType, {
			url: encodeURI(`${configs.serverUrl}/web/provider-auth/${provider}?${queryString}`)
		});
		return dispatch(goToSSOAuth(provider, { ...(info || emptyObject), mode: access }));
	} catch (error) {
		logError(`Unable to start ${provider} sign in: ${error}`);
	}
};

export const startIDESignin = (provider: SupportedSSOProvider, info?: SSOAuthInfo) => async (
	dispatch,
	getState: () => CodeStreamState
) => {
	try {
		const { session } = getState();
		const result = await HostApi.instance.send(ConnectToIDEProviderRequestType, { provider });
		const request: ProviderTokenRequest = {
			provider,
			token: result.accessToken,
			inviteCode: info && info.inviteCode,
			repoInfo: info && info.repoInfo,
			noSignup: !info || !info.fromSignup,
			data: {
				sessionId: result.sessionId
			}
		};
		if (session.otc) {
			request.signupToken = session.otc;
		}
		info = info || {};
		info.useIDEAuth = true;
		try {
			const fail = error => {
				info!.gotError = error;
				return dispatch(goToSSOAuth(provider, { ...(info || emptyObject) }));
			};
			HostApi.instance.send(ProviderTokenRequestType, request, { alternateReject: fail });
			return dispatch(goToSSOAuth(provider, { ...(info || emptyObject) }));
		} catch (tokenError) {
			info.gotError = true;
			return dispatch(goToSSOAuth(provider, { ...(info || emptyObject) }));
		}
	} catch (error) {
		logError(`Unable to start VSCode ${provider} sign in: ${error}`);
	}
};

export type PasswordLoginParams = Pick<PasswordLoginRequest, "email" | "password">;

export const authenticate = (params: PasswordLoginParams | TokenLoginRequest) => async (
	dispatch,
	getState: () => CodeStreamState
) => {
	const api = HostApi.instance;
	const response = await api.send(
		(params as any).password ? PasswordLoginRequestType : TokenLoginRequestType,
		{
			...params,
			team: getState().configs.team
		}
	);

	if (isLoginFailResponse(response)) {
		if (getState().session.inMaintenanceMode && response.error !== LoginResult.MaintenanceMode) {
			dispatch(setMaintenanceMode(false));
		}

		switch (response.error) {
			case LoginResult.MaintenanceMode:
				return dispatch(setMaintenanceMode(true, params));
			case LoginResult.MustSetPassword:
				return dispatch(goToSetPassword({ email: (params as PasswordLoginParams).email }));
			case LoginResult.NotOnTeam:
				return dispatch(
					goToTeamCreation({
						loggedIn: true,
						// since we're sure the error is NotOnTeam, params below must be email/password because token
						// login is for resuming previous sessions and this error means you haven't ever fully signed into the extension
						email: (params as PasswordLoginParams).email,
						token: response.extra.token
					})
				);
			default:
				throw response.error;
		}
	}

	api.track("Signed In", { "Auth Type": "CodeStream" });

	return dispatch(onLogin(response));
};

export const onLogin = (
	response: LoginSuccessResponse,
	isFirstPageview?: boolean
) => async dispatch => {
	const api = HostApi.instance;

	const [bootstrapData, { editorContext }, bootstrapCore] = await Promise.all([
		api.send(BootstrapRequestType, {}),
		api.send(GetActiveEditorContextRequestType, undefined),
		api.send(BootstrapInHostRequestType, undefined)
	]);

	await dispatch(
		bootstrap({
			...bootstrapCore,
			...bootstrapData,
			editorContext,
			session: { ...bootstrapCore.session, userId: response.state.userId },
			capabilities: response.state.capabilities,
			context: { currentTeamId: response.state.teamId, isFirstPageview }
		})
	);
};

export const completeSignup = (
	email: string,
	token: string,
	teamId: string,
	extra: { createdTeam: boolean; provider?: string }
) => async (dispatch, getState: () => CodeStreamState) => {
	const response = await HostApi.instance.send(TokenLoginRequestType, {
		token: {
			value: token,
			email,
			url: getState().configs.serverUrl
		},
		teamId
	});

	if (isLoginFailResponse(response)) {
		logError("There was an error completing signup", response);
		throw response.error;
	}

	const providerName = extra.provider
		? ProviderNames[extra.provider.toLowerCase()] || extra.provider
		: "CodeStream";
	HostApi.instance.track("Signup Completed", {
		"Signup Type": extra.createdTeam ? "Organic" : "Viral",
		"Auth Provider": providerName,
		Brand: "GitHub Enterprise"
	});
	dispatch(onLogin(response, true));
};

export const validateSignup = (provider: string, authInfo?: SSOAuthInfo) => async (
	dispatch,
	getState: () => CodeStreamState
) => {
	const response = await HostApi.instance.send(OtcLoginRequestType, {
		code: getState().session.otc!
	});

	if (isLoginFailResponse(response)) {
		if (getState().session.inMaintenanceMode && response.error !== LoginResult.MaintenanceMode) {
			dispatch(setMaintenanceMode(false));
		}

		switch (response.error) {
			case LoginResult.MaintenanceMode:
				return dispatch(setMaintenanceMode(true));
			case LoginResult.MustSetPassword:
				return dispatch(goToSetPassword(response.extra));
			case LoginResult.SignupRequired:
				return dispatch(goToSignup({ type: SignupType.CreateTeam }));
			case LoginResult.SignInRequired:
				return dispatch(goToLogin());
			case LoginResult.AlreadySignedIn:
				return dispatch(bootstrap());
			case LoginResult.NotOnTeam:
				HostApi.instance.track("Account Created", { email: response.extra.email });
				return dispatch(
					goToTeamCreation({
						email: response.extra && response.extra.email,
						token: response.extra && response.extra.token,
						provider
					})
				);
			case LoginResult.ProviderConnectFailed:
			// @ts-ignore - reset the otc and cascade to the default case
			case LoginResult.ExpiredToken:
				dispatch(setSession({ otc: uuid() }));
			default:
				throw response.error;
		}
	}

	if (authInfo && authInfo.fromSignup) {
		HostApi.instance.track("Account Created", {
			email: response.loginResponse.user.email
		});

		const providerName = provider
			? ProviderNames[provider.toLowerCase()] || provider
			: "CodeStream";
		HostApi.instance.track("Signup Completed", {
			"Signup Type": authInfo.type === SignupType.CreateTeam ? "Organic" : "Viral",
			"Auth Provider": providerName,
			Brand: "GitHub Enterprise"
		});

		return await dispatch(onLogin(response, true));
	} else {
		HostApi.instance.track("Signed In", { "Auth Type": provider });
		if (localStore.get("enablingRealTime") === true) {
			localStore.delete("enablingRealTime");
			HostApi.instance.track("Slack Chat Enabled");
			const result = await dispatch(onLogin(response));
			dispatch(setContext({ chatProviderAccess: "permissive" }));
			return result;
		}
	}
};
