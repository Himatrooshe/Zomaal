export interface SenditConnectionStatus {
  connected: boolean;
  provider: 'sendit.ma';
  accountName: string | null;
  connectedAt: string | null;
  message: string;
}
