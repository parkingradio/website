import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { generateToken, hashToken } from '../core/tokens.js'
import type { Queryable } from '../db/connection.js'
import { oauthCodes, oauthConnections, oauthRefreshTokens } from '../db/schema.js'
import { isUuid } from '../db/uuid.js'

// The connections of the apps admins allowed to act as them, the codes that make them, and their refresh tokens (see
// docs/design/server/oauth.md). The store takes codes and tokens as apps send them, and only keeps their hashes (see
// core/tokens.ts). A code or a refresh token that's used twice ends its connection, since someone else may have it: each
// step that uses one is a single conditional statement, so that two requests at the same time can't both use it.

export type NewCode = {
  userId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scopes: string[]
  expiresAt: Date
}

// A connection's tokens, as an exchange or a refresh gives them.
export type Tokens = {
  accessToken: string
  accessTokenExpiresAt: Date
  refreshToken: string
  // Which is also when the connection ends, unless it's used again before then.
  refreshTokenExpiresAt: Date
  scopes: string[]
}

export type StoredRefreshToken = { connectionId: string; userId: string; clientId: string; scopes: string[]; expiresAt: Date }

export type StoredConnection = { id: string; clientId: string; scopes: string[]; createdAt: Date; lastUsedAt: Date }

// The connection that a code would make, or that a refresh token is for, is gone, e.g. because it ended in the meantime.
export class NoSuchConnection extends Error {}

export type OAuthStore = {
  // Makes a code, returns it, and deletes the codes, refresh tokens and connections that expired.
  createCode(code: NewCode): Promise<string>
  // The code, if it wasn't used yet. A code that was is deleted, along with the connection it made. Null when there's none.
  findCode(code: string): Promise<NewCode | null>
  // Marks the code used, and returns true, unless it already was, e.g. by a request at the same time: it's then deleted,
  // along with the connection it made, and this returns false.
  useCode(code: string): Promise<boolean>
  // Makes the connection of a used code, with its first tokens, and returns its id. Throws NoSuchConnection when the code is
  // gone, i.e. it was used again.
  createConnection(code: string, tokens: Tokens): Promise<string>
  // The refresh token, if it wasn't used yet. One that was ends its connection. Null when there's none.
  findRefreshToken(token: string): Promise<StoredRefreshToken | null>
  // Marks the refresh token used, and returns true, unless it already was: its connection then ends, and this returns
  // false.
  useRefreshToken(token: string): Promise<boolean>
  // Gives a connection new tokens, which also counts as using it. Throws NoSuchConnection when it ended.
  refreshConnection(connectionId: string, tokens: Tokens): Promise<void>
  // Ends the connection of `clientId` that has this access or refresh token, if there's one.
  revoke(token: string, clientId: string): Promise<void>
  // The user's connections that haven't expired, the most recently used first.
  list(userId: string): Promise<StoredConnection[]>
  // Ends one of the user's connections, and returns whether there was one.
  delete(userId: string, id: string): Promise<boolean>
}

// Ends the user's connections, and the codes they were given, e.g. in the transaction where they choose a new password.
export async function endConnections(db: Queryable, userId: string) {
  await db.delete(oauthCodes).where(eq(oauthCodes.userId, userId))
  await db.delete(oauthConnections).where(eq(oauthConnections.userId, userId))
}

// Deletes the code with this hash, along with the connection it made, if it made one. Deleting the code waits for an
// exchange that's making its connection (see createConnection), and only a statement that starts after that sees the
// connection, so the connection is deleted by a statement of its own.
async function deleteCode(db: Queryable, codeHash: string) {
  await db.transaction(async (tx) => {
    const [code] = await tx.delete(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).returning({ connectionId: oauthCodes.connectionId })
    if (code?.connectionId) await tx.delete(oauthConnections).where(eq(oauthConnections.id, code.connectionId))
  })
}

// Ends the connection of the refresh token with this hash.
async function endConnectionOf(db: Queryable, tokenHash: string) {
  await db.execute(sql`
    delete from ${oauthConnections} where ${oauthConnections.id} in
      (select ${oauthRefreshTokens.connectionId} from ${oauthRefreshTokens} where ${oauthRefreshTokens.tokenHash} = ${tokenHash})`)
}

// What a connection keeps of its tokens.
function hashed({ accessToken, accessTokenExpiresAt, refreshTokenExpiresAt, scopes }: Tokens) {
  return { scopes, expiresAt: refreshTokenExpiresAt, accessTokenHash: hashToken(accessToken), accessTokenExpiresAt }
}

export function oauthStore(db: Queryable): OAuthStore {
  return {
    async createCode(code) {
      const now = new Date()
      await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now))
      await db.delete(oauthRefreshTokens).where(lt(oauthRefreshTokens.expiresAt, now))
      await db.delete(oauthConnections).where(lt(oauthConnections.expiresAt, now))
      const { token, tokenHash } = generateToken()
      await db.insert(oauthCodes).values({ codeHash: tokenHash, ...code })
      return token
    },

    async findCode(code) {
      const codeHash = hashToken(code)
      const [row] = await db
        .select({
          userId: oauthCodes.userId,
          clientId: oauthCodes.clientId,
          redirectUri: oauthCodes.redirectUri,
          codeChallenge: oauthCodes.codeChallenge,
          scopes: oauthCodes.scopes,
          expiresAt: oauthCodes.expiresAt,
          usedAt: oauthCodes.usedAt,
        })
        .from(oauthCodes)
        .where(eq(oauthCodes.codeHash, codeHash))
      if (!row) return null
      const { usedAt, ...stored } = row
      if (usedAt) {
        await deleteCode(db, codeHash)
        return null
      }
      return stored
    },

    async useCode(code) {
      const codeHash = hashToken(code)
      const used = await db
        .update(oauthCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt)))
        .returning({ id: oauthCodes.id })
      if (used.length > 0) return true
      await deleteCode(db, codeHash)
      return false
    },

    async createConnection(code, tokens) {
      const codeHash = hashToken(code)
      return db.transaction(async (tx) => {
        // Locked until the connection is made and linked to it, so that using the code again at the same time waits, then
        // ends that connection (see deleteCode), or else deletes the code first, which makes this fail.
        const [used] = await tx
          .select({ userId: oauthCodes.userId, clientId: oauthCodes.clientId })
          .from(oauthCodes)
          .where(eq(oauthCodes.codeHash, codeHash))
          .for('update')
        if (!used) throw new NoSuchConnection()
        const [connection] = await tx
          .insert(oauthConnections)
          .values({ userId: used.userId, clientId: used.clientId, ...hashed(tokens) })
          .returning({ id: oauthConnections.id })
        await tx.update(oauthCodes).set({ connectionId: connection.id }).where(eq(oauthCodes.codeHash, codeHash))
        await tx
          .insert(oauthRefreshTokens)
          .values({ tokenHash: hashToken(tokens.refreshToken), connectionId: connection.id, expiresAt: tokens.refreshTokenExpiresAt })
        return connection.id
      })
    },

    async findRefreshToken(token) {
      const tokenHash = hashToken(token)
      const [row] = await db
        .select({
          connectionId: oauthConnections.id,
          userId: oauthConnections.userId,
          clientId: oauthConnections.clientId,
          scopes: oauthConnections.scopes,
          expiresAt: oauthRefreshTokens.expiresAt,
          usedAt: oauthRefreshTokens.usedAt,
        })
        .from(oauthRefreshTokens)
        .innerJoin(oauthConnections, eq(oauthConnections.id, oauthRefreshTokens.connectionId))
        .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
      if (!row) return null
      const { usedAt, ...stored } = row
      if (usedAt) {
        await endConnectionOf(db, tokenHash)
        return null
      }
      return stored
    },

    async useRefreshToken(token) {
      const tokenHash = hashToken(token)
      const used = await db
        .update(oauthRefreshTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(oauthRefreshTokens.tokenHash, tokenHash), isNull(oauthRefreshTokens.usedAt)))
        .returning({ id: oauthRefreshTokens.id })
      if (used.length > 0) return true
      await endConnectionOf(db, tokenHash)
      return false
    },

    async refreshConnection(connectionId, tokens) {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(oauthConnections)
          .set({ ...hashed(tokens), lastUsedAt: new Date() })
          .where(eq(oauthConnections.id, connectionId))
          .returning({ id: oauthConnections.id })
        if (updated.length === 0) throw new NoSuchConnection()
        // The connection's used refresh tokens are kept until they expire, to tell when one is used again: those that did
        // go here, so that a connection that's used for long doesn't pile them up.
        await tx.delete(oauthRefreshTokens).where(and(eq(oauthRefreshTokens.connectionId, connectionId), lt(oauthRefreshTokens.expiresAt, new Date())))
        await tx.insert(oauthRefreshTokens).values({ tokenHash: hashToken(tokens.refreshToken), connectionId, expiresAt: tokens.refreshTokenExpiresAt })
      })
    },

    async revoke(token, clientId) {
      const tokenHash = hashToken(token)
      await db.execute(sql`
        delete from ${oauthConnections} where ${oauthConnections.clientId} = ${clientId} and (
          ${oauthConnections.accessTokenHash} = ${tokenHash} or ${oauthConnections.id} in
            (select ${oauthRefreshTokens.connectionId} from ${oauthRefreshTokens} where ${oauthRefreshTokens.tokenHash} = ${tokenHash}))`)
    },

    async list(userId) {
      return db
        .select({
          id: oauthConnections.id,
          clientId: oauthConnections.clientId,
          scopes: oauthConnections.scopes,
          createdAt: oauthConnections.createdAt,
          lastUsedAt: oauthConnections.lastUsedAt,
        })
        .from(oauthConnections)
        .where(and(eq(oauthConnections.userId, userId), gt(oauthConnections.expiresAt, new Date())))
        .orderBy(desc(oauthConnections.lastUsedAt))
    },

    async delete(userId, id) {
      if (!isUuid(id)) return false
      const deleted = await db
        .delete(oauthConnections)
        .where(and(eq(oauthConnections.id, id), eq(oauthConnections.userId, userId), gt(oauthConnections.expiresAt, new Date())))
        .returning({ id: oauthConnections.id })
      return deleted.length > 0
    },
  }
}
