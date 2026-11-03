import OAuth2Server from '@node-oauth/oauth2-server'
import { findClient } from './clients.js'
import { NoSuchConnection } from './store.js'
import type { OAuthStore } from './store.js'

// What the OAuth library calls to exchange codes and refresh tokens at the token endpoint (see app-routes.ts), on top of
// the store.

const { InvalidGrantError } = OAuth2Server

// The grants the token endpoint takes.
export const GRANT_TYPES = ['authorization_code', 'refresh_token']

// The tokens the library makes with every exchange and refresh, with the lifetimes app-routes.ts gives it. Its own type
// for them has an index signature, which makes TypeScript lose their fields once they're picked.
type LibraryTokens = {
  accessToken: string
  accessTokenExpiresAt: Date
  refreshToken: string
  refreshTokenExpiresAt: Date
  scope: string[]
}

// The library's models also authenticate requests with access tokens, and save the codes the library would issue, neither
// of which the token endpoint does: the authorization routes issue codes themselves (see routes.ts).
export type TokenModel = Omit<
  OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel,
  'getAccessToken' | 'verifyScope' | 'saveAuthorizationCode'
>

export function tokenModel(store: OAuthStore): TokenModel {
  return {
    async getClient(clientId) {
      const client = findClient(clientId)
      return client ? { id: client.id, redirectUris: client.redirectUris, grants: GRANT_TYPES } : null
    },

    async getAuthorizationCode(code) {
      const stored = await store.findCode(code)
      if (!stored) return null
      return {
        authorizationCode: code,
        expiresAt: stored.expiresAt,
        redirectUri: stored.redirectUri,
        scope: stored.scopes,
        codeChallenge: stored.codeChallenge,
        codeChallengeMethod: 'S256',
        client: { id: stored.clientId, grants: [] },
        user: { id: stored.userId },
      }
    },

    async revokeAuthorizationCode(code) {
      return store.useCode(code.authorizationCode)
    },

    async getRefreshToken(refreshToken) {
      const stored = await store.findRefreshToken(refreshToken)
      if (!stored) return null
      return {
        refreshToken,
        refreshTokenExpiresAt: stored.expiresAt,
        scope: stored.scopes,
        client: { id: stored.clientId, grants: [] },
        // The connection is how saveToken tells which one a refresh is for.
        user: { id: stored.userId, connectionId: stored.connectionId },
      }
    },

    async revokeToken(token) {
      return store.useRefreshToken(token.refreshToken)
    },

    // Makes the connection of an exchanged code, or gives a connection new tokens. Either one fails as an invalid grant
    // when its connection is gone, e.g. because its code or refresh token was used again at the same time, rather than
    // answering with tokens that would never work.
    async saveToken(token, client, user) {
      const { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, scope } = token as LibraryTokens
      const tokens = { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, scopes: scope }
      try {
        if (token.authorizationCode) await store.createConnection(token.authorizationCode, tokens)
        else await store.refreshConnection(user.connectionId, tokens)
      } catch (error) {
        if (error instanceof NoSuchConnection) throw new InvalidGrantError('Invalid grant: the connection ended')
        throw error
      }
      return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, scope, client, user }
    },
  }
}
