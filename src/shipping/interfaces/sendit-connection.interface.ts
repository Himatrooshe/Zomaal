export interface SenditConnectionStatus {
  connected: boolean;
  provider: 'sendit.ma';
  accountName: string | null;
  message: string;
}
