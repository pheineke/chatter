import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAuditLogs } from '../api/servers'
import { getUser } from '../api/users'
import { UserAvatar } from './UserAvatar'
import { Icon } from './Icon'
import type { AuditLogEntry } from '../api/types'

const AUDIT_LOG_ACTIONS = [
  'SERVER_UPDATE', 'CHANNEL_CREATE', 'CHANNEL_UPDATE', 'CHANNEL_DELETE',
  'MEMBER_KICK', 'MEMBER_BAN', 'MEMBER_UNBAN', 'MEMBER_ROLE_UPDATE',
  'ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE', 'INVITE_CREATE', 'INVITE_DELETE',
  'MESSAGE_DELETE', 'MESSAGE_PIN', 'MESSAGE_UNPIN'
]

function AuditLogItem({ entry }: { entry: AuditLogEntry }) {
  // Fetch user details for the actor
  const { data: actor } = useQuery({
    queryKey: ['user', entry.user_id],
    queryFn: () => (entry.user_id ? getUser(entry.user_id) : null),
    enabled: !!entry.user_id,
  })

  // Format timestamp
  const date = new Date(entry.created_at).toLocaleString()

  // Helper to format action string
  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ')
  }

  // Helper to format changes
  const formatChanges = (changes: Record<string, any> | null) => {
    if (!changes || Object.keys(changes).length === 0) return null
    return (
      <div className="mt-1 text-xs text-gray-400 bg-gray-900/50 p-2 rounded">
        {Object.entries(changes).map(([key, value]) => (
          <div key={key}>
            <span className="font-semibold text-gray-300">{key}:</span> {JSON.stringify(value)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex gap-3 p-3 bg-gray-700/30 rounded border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex-shrink-0">
        {actor ? (
           <UserAvatar user={actor} size="md" />
        ) : (
          <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center">
            <Icon name="person" className="w-5 h-5 text-gray-400" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-white">
            {actor ? actor.username : 'Unknown User'}
          </span>
          <span className="text-xs text-gray-400">{date}</span>
        </div>
        <div className="text-sm text-gray-300">
          <span className="font-semibold text-indigo-400">{formatAction(entry.action_type)}</span>
          {entry.target_id && (
            <span className="ml-1 text-gray-500">Target: {entry.target_id}</span>
          )}
        </div>
        {formatChanges(entry.changes)}
        {entry.reason && (
           <div className="mt-1 text-xs italic text-gray-400">Reason: {entry.reason}</div>
        )}
      </div>
    </div>
  )
}

interface ServerAuditLogProps {
  serverId: string
}

export function ServerAuditLog({ serverId }: ServerAuditLogProps) {
  const [page, setPage] = useState(0)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const limit = 50

  const { data: logs, isLoading, error } = useQuery({
    queryKey: ['audit-logs', serverId, page, filterUser, filterAction],
    queryFn: () => getAuditLogs(serverId, limit, page * limit, filterUser || undefined, filterAction || undefined),
  })

  // Reset page when filters change
  const handleFilterUser = (val: string) => { setFilterUser(val); setPage(0); }
  const handleFilterAction = (val: string) => { setFilterAction(val); setPage(0); }

  if (isLoading) return <div className="p-4 text-center text-gray-400">Loading audit logs...</div>
  if (error) return <div className="p-4 text-center text-red-400">Failed to load audit logs</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 mb-4">
        <h3 className="text-lg font-medium text-white">Audit Log</h3>
        
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-800/50 p-3 rounded border border-gray-700">
          <div className="flex items-center gap-2">
            <Icon name="person" size={16} className="text-gray-400" />
            <input 
              type="text" 
              placeholder="Filter by User ID" 
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500 w-48"
              value={filterUser}
              onChange={e => handleFilterUser(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Icon name="list" size={16} className="text-gray-400" />
            <select 
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-indigo-500 w-48"
              value={filterAction}
              onChange={e => handleFilterAction(e.target.value)}
            >
              <option value="">All Actions</option>
              {AUDIT_LOG_ACTIONS.map(action => (
                <option key={action} value={action}>{action.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex-1"></div>
          <div className="flex gap-2">
              <button 
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
              >
                  Previous
              </button>
              <button 
                  onClick={() => setPage(p => p + 1)}
                  disabled={!logs || logs.length < limit}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
              >
                  Next
              </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {logs?.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No audit logs found</div>
        ) : (
          logs?.map((log) => (
            <AuditLogItem key={log.id} entry={log} />
          ))
        )}
      </div>
    </div>
  )
}
