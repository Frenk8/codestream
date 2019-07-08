﻿using CodeStream.VisualStudio.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace CodeStream.VisualStudio.Models {
	public class DidChangeConnectionStatusNotification {
		public bool? Reset { get; set; }
		public ConnectionStatus Status { get; set; }
	}

	public class DidChangeConnectionStatusNotificationType : NotificationType<DidChangeConnectionStatusNotification> {
		public DidChangeConnectionStatusNotificationType(DidChangeConnectionStatusNotification @params) {
			Params = @params;
		}

		public const string MethodName = "codestream/didChangeConnectionStatus";
		public override string Method => MethodName;
	}

	public class DidChangeDataNotificationTypeParams { }
	public class DidChangeDataNotificationType : NotificationType<DidChangeDataNotificationTypeParams> {
		private readonly JToken _token;

		public DidChangeDataNotificationType(JToken token) {
			_token = token;
		}

		public const string MethodName = "codestream/didChangeData";
		public override string Method => MethodName;

		public override string AsJson() {
			return CustomNotificationPayload.Create(Method, _token);
		}
	}

	[JsonConverter(typeof(CamelCaseStringEnumConverter))]
	public enum ChangeReason {
		Document,
		Codemarks
	}

	public class DidChangeDocumentMarkersNotification {
		public TextDocumentIdentifier TextDocument { get; set; }
		public ChangeReason? Reason { get; set; }
	}

	public class DidChangeDocumentMarkersNotificationType : NotificationType<DidChangeDocumentMarkersNotification> {
		public const string MethodName = "codestream/didChangeDocumentMarkers";
		public override string Method => MethodName;
	}

	//export enum VersionCompatibility
	//{
	//    Compatible = "ok",
	//    CompatibleUpgradeAvailable = "outdated",
	//    CompatibleUpgradeRecommended = "deprecated",
	//    UnsupportedUpgradeRequired = "incompatible",
	//    Unknown = "unknownVersion"
	//}

	public class DidChangeVersionCompatibilityNotification {
		public string Compatibility { get; set; }
		public string DownloadUrl { get; set; }
		public string Version { get; set; }
	}

	public class DidChangeVersionCompatibilityNotificationType : NotificationType<DidChangeVersionCompatibilityNotification> {
		private readonly JToken _token;

		public DidChangeVersionCompatibilityNotificationType(JToken token) {
			_token = token;
		}

		public const string MethodName = "codestream/didChangeVersionCompatibility";
		public override string Method => MethodName;

		public override string AsJson() {
			return CustomNotificationPayload.Create(Method, _token);
		}
	}

	public class DidLogoutNotification {
		public LogoutReason Reason { get; set; }
	}

	public class DidLogoutNotificationType : NotificationType<DidLogoutNotification> {
		public const string MethodName = "codestream/didLogout";
		public override string Method => MethodName;
	}


	public class DidLoginNotification {
		public LoginSuccessResponse Data { get; set; }
	}

	public class DidLoginNotificationType : NotificationType<DidLoginNotification> {
		public const string MethodName = "codestream/didLogin";
		public override string Method => MethodName;
	}

	public class DidStartLoginNotification { }

	public class DidStartLoginNotificationType : NotificationType<DidStartLoginNotification> {

		public const string MethodName = "codestream/didStartLogin";
		public override string Method => MethodName;
	}

	public class DidFailLoginNotification { }
	public class DidFailLoginNotificationType : NotificationType<DidFailLoginNotification> {
		public const string MethodName = "codestream/didFailLogin";
		public override string Method => MethodName;
	}
}
