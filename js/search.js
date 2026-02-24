/* ========================================
   SYSTÈME DE RECHERCHE
   ======================================== */

let searchResults = [];
let searchTimeout = null;

// Initialiser la recherche
function initializeSearch() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Debounce pour éviter trop de requêtes
        clearTimeout(searchTimeout);
        
        if (query.length < 2) {
            searchResults.style.display = 'none';
            return;
        }
        
        searchTimeout = setTimeout(() => {
            performSearch(query);
        }, 300);
    });
    
    // Fermer les résultats en cliquant ailleurs
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResults.style.display = 'none';
        }
    });
}

// Effectuer la recherche
async function performSearch(query) {
    const searchResultsContainer = document.getElementById('search-results');
    
    try {
        // Rechercher dans les utilisateurs
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('*')
            .or(`name.ilike.%${query}%,title.ilike.%${query}%,bio.ilike.%${query}%`)
            .limit(10);
        
        if (usersError) throw usersError;
        
        // Rechercher dans le contenu
        const { data: content, error: contentError } = await supabase
            .from('content')
            .select('*, users(name, avatar)')
            .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
            .limit(10);
        
        if (contentError) throw contentError;
        
        if (typeof window.recordSearchPreference === 'function') {
            window.recordSearchPreference(query);
        }

        // Afficher les résultats
        displaySearchResults(users, content, query);
        
    } catch (error) {
        console.error('Erreur recherche:', error);
        searchResultsContainer.innerHTML = `
            <div class="search-error">
                <p>Erreur lors de la recherche</p>
            </div>
        `;
        searchResultsContainer.style.display = 'block';
    }
}

// Afficher les résultats de recherche
function displaySearchResults(users, content, query) {
    const searchResultsContainer = document.getElementById('search-results');
    
    if (users.length === 0 && content.length === 0) {
        searchResultsContainer.innerHTML = `
            <div class="search-empty">
                <p>Aucun résultat pour "${query}"</p>
            </div>
        `;
        searchResultsContainer.style.display = 'block';
        return;
    }
    
    let html = '';
    
    // Section Utilisateurs
    if (users.length > 0) {
        html += '<div class="search-section">';
        html += '<h4 class="search-section-title">Utilisateurs</h4>';
        users.forEach(user => {
            html += `
                <div class="search-result-item" onclick="navigateToUserProfile('${user.id}'); document.getElementById('search-results').style.display='none';">
                    <img src="${user.avatar}" class="search-result-avatar" alt="${user.name}">
                    <div class="search-result-info">
                        <div class="search-result-name">${typeof window.renderUsernameWithBadge === 'function' ? window.renderUsernameWithBadge(highlightMatch(user.name, query), user.id) : highlightMatch(user.name, query)}</div>
                        <div class="search-result-meta">${user.title || ''}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    // Section Contenu
    if (content.length > 0) {
        html += '<div class="search-section">';
        html += '<h4 class="search-section-title">Publications</h4>';
        content.forEach(item => {
            html += `
                <div class="search-result-item" onclick="navigateToUserProfile('${item.user_id}'); document.getElementById('search-results').style.display='none';">
                    <img src="${item.users.avatar}" class="search-result-avatar" alt="${item.users.name}">
                    <div class="search-result-info">
                        <div class="search-result-name">${highlightMatch(item.title, query)}</div>
                        <div class="search-result-meta">Par ${typeof window.renderUsernameWithBadge === 'function' ? window.renderUsernameWithBadge(item.users.name, item.user_id) : item.users.name} • Jour ${item.day_number}</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    searchResultsContainer.innerHTML = html;
    searchResultsContainer.style.display = 'block';
}

// Mettre en évidence les correspondances
function highlightMatch(text, query) {
    if (!text) return '';
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}
