export interface SenditLoginResponse {
  success: boolean;
  message: string;
  data?: {
    token?: string;
    name?: string;
  };
}
