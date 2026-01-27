import { google } from "googleapis";

// Uses a user OAuth access token (from frontend) to call Workspace APIs.
export function googleClientFromAccessToken(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  return {
    drive: google.drive({ version: "v3", auth }),
    docs: google.docs({ version: "v1", auth }),
    sheets: google.sheets({ version: "v4", auth }),
    slides: google.slides({ version: "v1", auth }),
  };
}
