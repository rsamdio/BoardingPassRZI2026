// Optimistic UI Helper Module
// Centralized module for managing optimistic UI updates with rollback capability

const OptimisticUI = {
    // Track pending operations for rollback
    pendingOperations: new Map(),
    
    /**
     * Add item optimistically to local state and render immediately
     * @param {string} type - 'task', 'quiz', 'form', or 'activity'
     * @param {Object} item - Item to add (must have 'id' property)
     * @param {Function} renderCallback - Callback to render the updated list
     * @param {Array} stateArray - Reference to the state array (e.g., AdminTasks.tasks)
     * @returns {string} - Operation ID for potential rollback
     */
    addItem(type, item, renderCallback, stateArray) {
        if (!item || !item.id) {
            console.error('OptimisticUI.addItem: Item must have an id property');
            return null;
        }
        
        const operationId = `${type}_${item.id}_${Date.now()}`;
        
        // Store original state for rollback
        const originalState = stateArray ? [...stateArray] : null;
        
        // Add to state array immediately
        if (stateArray) {
            // Check if item already exists (avoid duplicates)
            const exists = stateArray.find(i => i.id === item.id);
            if (!exists) {
                stateArray.push(item);
                // Sort by updatedAt or createdAt (newest first)
                stateArray.sort((a, b) => {
                    const aTime = a.updatedAt || a.createdAt || 0;
                    const bTime = b.updatedAt || b.createdAt || 0;
                    return bTime - aTime;
                });
            }
        }
        
        // Track operation for rollback
        this.pendingOperations.set(operationId, {
            type: 'add',
            itemType: type,
            itemId: item.id,
            originalState: originalState,
            stateArray: stateArray,
            timestamp: Date.now()
        });
        
        // Render immediately with fade-in animation
        if (renderCallback) {
            renderCallback();
            // Add fade-in animation to the new item
            setTimeout(() => {
                const element = document.querySelector(`[data-${type}-id="${item.id}"]`);
                if (element) {
                    element.classList.add('animate-fade-in');
                }
            }, 10);
        }
        
        // Auto-remove from pending operations after 30 seconds (operation confirmed)
        setTimeout(() => {
            this.pendingOperations.delete(operationId);
        }, 30000);
        
        return operationId;
    },
    
    /**
     * Remove item optimistically from local state with fade-out animation
     * @param {string} type - 'task', 'quiz', 'form', or 'activity'
     * @param {string} itemId - Item ID to remove
     * @param {Function} renderCallback - Callback to render the updated list
     * @param {Array} stateArray - Reference to the state array
     * @returns {string} - Operation ID for potential rollback
     */
    removeItem(type, itemId, renderCallback, stateArray) {
        if (!itemId) {
            console.error('OptimisticUI.removeItem: itemId is required');
            return null;
        }
        
        const operationId = `${type}_${itemId}_${Date.now()}`;
        
        // Store original state for rollback
        const originalState = stateArray ? [...stateArray] : null;
        const removedItem = stateArray ? stateArray.find(i => i.id === itemId) : null;
        
        // Find and animate the element first
        const element = document.querySelector(`[data-${type}-id="${itemId}"]`);
        if (element) {
            element.classList.add('fade-out-slide-down');
            element.style.pointerEvents = 'none';
        }
        
        // Remove from state array after animation starts
        setTimeout(() => {
            if (stateArray) {
                const index = stateArray.findIndex(i => i.id === itemId);
                if (index !== -1) {
                    stateArray.splice(index, 1);
                }
            }
            
            // Remove element from DOM after animation
            if (element) {
                setTimeout(() => {
                    element.remove();
                    if (renderCallback) {
                        renderCallback();
                    }
                }, 300); // Match animation duration
            } else if (renderCallback) {
                renderCallback();
            }
        }, 10);
        
        // Track operation for rollback
        this.pendingOperations.set(operationId, {
            type: 'remove',
            itemType: type,
            itemId: itemId,
            originalState: originalState,
            removedItem: removedItem,
            stateArray: stateArray,
            timestamp: Date.now()
        });
        
        // Auto-remove from pending operations after 30 seconds
        setTimeout(() => {
            this.pendingOperations.delete(operationId);
        }, 30000);
        
        return operationId;
    },
    
    /**
     * Update item optimistically in local state
     * @param {string} type - 'task', 'quiz', 'form', or 'activity'
     * @param {string} itemId - Item ID to update
     * @param {Object} updates - Updates to apply
     * @param {Function} renderCallback - Callback to render the updated list
     * @param {Array} stateArray - Reference to the state array
     * @returns {string} - Operation ID for potential rollback
     */
    updateItem(type, itemId, updates, renderCallback, stateArray) {
        if (!itemId || !updates) {
            console.error('OptimisticUI.updateItem: itemId and updates are required');
            return null;
        }
        
        const operationId = `${type}_${itemId}_${Date.now()}`;
        
        // Store original item for rollback
        let originalItem = null;
        if (stateArray) {
            const item = stateArray.find(i => i.id === itemId);
            if (item) {
                originalItem = { ...item };
                // Apply updates
                Object.assign(item, updates);
            }
        }
        
        // Track operation for rollback
        this.pendingOperations.set(operationId, {
            type: 'update',
            itemType: type,
            itemId: itemId,
            originalItem: originalItem,
            updates: updates,
            stateArray: stateArray,
            timestamp: Date.now()
        });
        
        // Render immediately
        if (renderCallback) {
            renderCallback();
        }
        
        // Auto-remove from pending operations after 30 seconds
        setTimeout(() => {
            this.pendingOperations.delete(operationId);
        }, 30000);
        
        return operationId;
    },
    
    /**
     * Rollback an optimistic operation
     * @param {string} operationId - Operation ID returned from add/remove/update
     * @param {Function} renderCallback - Callback to render after rollback
     * @returns {boolean} - Success status
     */
    rollback(operationId, renderCallback) {
        const operation = this.pendingOperations.get(operationId);
        if (!operation) {
            console.warn(`OptimisticUI.rollback: Operation ${operationId} not found`);
            return false;
        }
        
        try {
            const { type, itemType, itemId, stateArray } = operation;
            
            if (type === 'add') {
                // Remove the added item
                if (stateArray) {
                    const index = stateArray.findIndex(i => i.id === itemId);
                    if (index !== -1) {
                        stateArray.splice(index, 1);
                    }
                }
                // Remove from DOM
                const element = document.querySelector(`[data-${itemType}-id="${itemId}"]`);
                if (element) {
                    element.remove();
                }
            } else if (type === 'remove') {
                // Restore the removed item
                if (stateArray && operation.removedItem) {
                    stateArray.push(operation.removedItem);
                    // Re-sort
                    stateArray.sort((a, b) => {
                        const aTime = a.updatedAt || a.createdAt || 0;
                        const bTime = b.updatedAt || b.createdAt || 0;
                        return bTime - aTime;
                    });
                }
            } else if (type === 'update') {
                // Restore original item
                if (stateArray && operation.originalItem) {
                    const index = stateArray.findIndex(i => i.id === itemId);
                    if (index !== -1) {
                        stateArray[index] = { ...operation.originalItem };
                    }
                }
            }
            
            // Remove from pending operations
            this.pendingOperations.delete(operationId);
            
            // Re-render
            if (renderCallback) {
                renderCallback();
            }
            
            return true;
        } catch (error) {
            console.error('OptimisticUI.rollback error:', error);
            return false;
        }
    },
    
    /**
     * Rollback all pending operations for a specific item
     * Useful when an operation fails and we need to restore state
     * @param {string} type - Item type
     * @param {string} itemId - Item ID
     * @param {Function} renderCallback - Callback to render after rollback
     * @returns {number} - Number of operations rolled back
     */
    rollbackItem(type, itemId, renderCallback) {
        let rolledBack = 0;
        
        for (const [operationId, operation] of this.pendingOperations.entries()) {
            if (operation.itemType === type && operation.itemId === itemId) {
                if (this.rollback(operationId, renderCallback)) {
                    rolledBack++;
                }
            }
        }
        
        return rolledBack;
    },
    
    /**
     * Clear all pending operations (useful for cleanup)
     */
    clearPendingOperations() {
        this.pendingOperations.clear();
    },
    
    /**
     * Get pending operations count (for debugging)
     * @returns {number}
     */
    getPendingOperationsCount() {
        return this.pendingOperations.size;
    }
};
