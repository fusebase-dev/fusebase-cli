interface AuthExpiredModalProps {
  onClose: () => void
}

/**
 * Session Expired modal — shown when AppTokenValidationError is caught.
 * Required by all Fusebase Apps features.
 */
export function AuthExpiredModal({ onClose }: AuthExpiredModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <h2 className="text-lg font-semibold mb-2">Session Expired</h2>
        <p className="text-gray-600 mb-6">
          Your authentication expired, please refresh the page to authenticate again.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Refresh page
          </button>
        </div>
      </div>
    </div>
  )
}
