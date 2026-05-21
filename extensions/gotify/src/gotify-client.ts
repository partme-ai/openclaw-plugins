import type {
  GotifyApplicationInfo,
  GotifyMessagePayload,
  GotifyMessageResponse,
  ResolvedGotifyAccount,
} from './types.js';
import { createApplication, listApplications, sendGotifyMessage } from './gotify-api.js';

export class GotifyClient {
  constructor(private readonly account: ResolvedGotifyAccount) {}

  async sendMessage(payload: GotifyMessagePayload): Promise<GotifyMessageResponse> {
    return await sendGotifyMessage(this.account, payload);
  }

  async bootstrapApplication(params: {
    name: string;
    description?: string;
  }): Promise<GotifyApplicationInfo> {
    return await createApplication(this.account, params);
  }

  async getApplications(): Promise<GotifyApplicationInfo[]> {
    return await listApplications(this.account);
  }
}
