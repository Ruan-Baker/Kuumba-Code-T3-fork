// apps/relay/src/types.ts

/** Messages FROM client TO relay */
export type ClientToRelayMessage =
  | RegisterMessage
  | ForwardMessage
  | QueryDevicesMessage
  | PairRequestMessage;

export interface RegisterMessage {
  type: "register";
  deviceId: string;
  deviceName: string;
  pairingToken: string;
  publicKey: string;
  sessions: RelaySessionInfo[];
}

export interface ForwardMessage {
  type: "forward";
  targetDeviceId: string;
  encrypted: { iv: string; data: string };
}

export interface QueryDevicesMessage {
  type: "query-devices";
}

export interface PairRequestMessage {
  type: "pair-request";
  targetDeviceId: string;
  pairingToken: string;
  publicKey: string;
  deviceName: string;
}

/** Messages FROM relay TO client */
export type RelayToClientMessage =
  | RegisterAckMessage
  | ForwardedMessage
  | DeviceListMessage
  | PairAcceptedMessage
  | PairRejectedMessage
  | DeviceOnlineMessage
  | DeviceOfflineMessage
  | ErrorMessage;

export interface RegisterAckMessage {
  type: "register-ack";
  success: boolean;
}

export interface ForwardedMessage {
  type: "forwarded";
  fromDeviceId: string;
  fromDeviceName: string;
  encrypted: { iv: string; data: string };
}

export interface DeviceListMessage {
  type: "device-list";
  devices: Array<{
    deviceId: string;
    deviceName: string;
    online: boolean;
    sessions: RelaySessionInfo[];
  }>;
}

export interface PairAcceptedMessage {
  type: "pair-accepted";
  deviceId: string;
  deviceName: string;
  publicKey: string;
}

export interface PairRejectedMessage {
  type: "pair-rejected";
  deviceId: string;
  reason: string;
}

export interface DeviceOnlineMessage {
  type: "device-online";
  deviceId: string;
  deviceName: string;
  sessions: RelaySessionInfo[];
}

export interface DeviceOfflineMessage {
  type: "device-offline";
  deviceId: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface RelaySessionInfo {
  threadId: string;
  projectId: string;
  projectName: string;
  projectCwd: string;
  status: string;
  title: string;
}
