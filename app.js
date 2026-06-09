// DOM Elements
const apiKeyInput = document.getElementById("api-key");
const channelsListContainer = document.getElementById("channels-list-container");
const showModeButtons = Array.from(document.querySelectorAll(".show-mode-btn"));
const hideWatchedCheckbox = document.getElementById("hide-watched");
const resetWatchedBtn = document.getElementById("reset-watched");
const fetchBtn = document.getElementById("fetch-btn");
const loadMoreBtn = document.getElementById("load-more");
const videoListEl = document.getElementById("video-list");
const errorContainer = document.getElementById("error-container");
const loadingIndicator = document.getElementById("loading-indicator");
const videoCountText = document.getElementById("video-count-text");

function loadChannels() {
    const raw = localStorage.getItem("ytChannels") || "";
    if (!raw.trim()) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map(c => {
                if (typeof c === 'string') return { value: c, enabled: true };
                return { value: c.value || "", enabled: c.enabled !== false };
            });
        }
    } catch (e) {
        // Fallback to plain text parsing
    }
    return raw
        .split(/[\n,]+/)
        .map((c) => c.trim())
        .filter((c) => c)
        .map(c => ({ value: c, enabled: true }));
}

function saveChannels(channels) {
    localStorage.setItem("ytChannels", JSON.stringify(channels));
}

// 1. Central State Object
const state = {
    apiKey: localStorage.getItem("ytApiKey") || "",
    channels: loadChannels(),
    showAddRow: false,
    videos: [], // Collection of all fetched video objects
    activeChannels: [],
    channelIcons: {},
    filters: {
        mode: localStorage.getItem("ytShowMode") || "all", // all | shorts | longs
        hideWatched: localStorage.getItem("ytHideWatched") === "true",
    },
    watchedIds: JSON.parse(localStorage.getItem("ytWatchedVideos") || "{}"),
    playingVideoId: null,
    expandedVideoId: null,
    isFetching: false,
    error: null,
};

// 2. Initialize App
document.addEventListener("DOMContentLoaded", () => {
    apiKeyInput.value = state.apiKey;
    hideWatchedCheckbox.checked = state.filters.hideWatched;

    updateFilterButtonsUI();

    if (state.apiKey && state.channels.some(c => c.enabled && c.value.trim())) {
        fetchAllVideos();
    } else {
        renderApp();
    }
});

// 3. Event Listeners
fetchBtn.addEventListener("click", fetchAllVideos);
loadMoreBtn.addEventListener("click", fetchNextBatch);

apiKeyInput.addEventListener("input", (e) => {
    state.apiKey = e.target.value;
    localStorage.setItem("ytApiKey", state.apiKey);
});

function handleConfirmAddChannel() {
    const input = document.getElementById("new-channel-input");
    if (!input) return;
    const value = input.value.trim();
    if (value) {
        state.channels.push({ value: value, enabled: true });
        saveChannels(state.channels);
    }
    state.showAddRow = false;
    renderApp();
}

channelsListContainer.addEventListener("change", (e) => {
    const checkbox = e.target.closest(".channel-toggle-checkbox");
    if (checkbox) {
        const index = parseInt(checkbox.dataset.index);
        state.channels[index].enabled = checkbox.checked;
        saveChannels(state.channels);
        renderApp();
    }
});

channelsListContainer.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".btn-delete");
    if (deleteBtn) {
        const index = parseInt(deleteBtn.dataset.index);
        state.channels.splice(index, 1);
        saveChannels(state.channels);
        renderApp();
        return;
    }

    const addBtn = e.target.closest(".add-channel-btn");
    if (addBtn) {
        state.showAddRow = true;
        renderApp();
        return;
    }

    const confirmBtn = e.target.closest("#confirm-new-channel");
    if (confirmBtn) {
        handleConfirmAddChannel();
        return;
    }

    const cancelBtn = e.target.closest("#cancel-new-channel");
    if (cancelBtn) {
        state.showAddRow = false;
        renderApp();
        return;
    }
});

channelsListContainer.addEventListener("keydown", (e) => {
    if (e.target.id === "new-channel-input") {
        if (e.key === "Enter") {
            e.preventDefault();
            handleConfirmAddChannel();
        } else if (e.key === "Escape") {
            e.preventDefault();
            state.showAddRow = false;
            renderApp();
        }
    }
});

showModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setFilterMode(button.dataset.mode || "all");
    });
});

hideWatchedCheckbox.addEventListener("change", (e) => {
    state.filters.hideWatched = e.target.checked;
    localStorage.setItem("ytHideWatched", state.filters.hideWatched);
    renderApp();
});

resetWatchedBtn.addEventListener("click", () => {
    state.watchedIds = {};
    localStorage.removeItem("ytWatchedVideos");
    renderApp();
});

// 4. State Mutators
function setFilterMode(mode) {
    state.filters.mode = mode;
    localStorage.setItem("ytShowMode", mode);
    updateFilterButtonsUI();
    renderApp();
}

function updateFilterButtonsUI() {
    showModeButtons.forEach((button) => {
        const isActive = button.dataset.mode === state.filters.mode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
}

function markVideoAsWatched(videoId) {
    if (!state.watchedIds[videoId]) {
        state.watchedIds[videoId] = true;
        localStorage.setItem("ytWatchedVideos", JSON.stringify(state.watchedIds));
        setTimeout(() => renderApp(), 0);
    }
}

function toggleVideoWatched(videoId) {
    if (state.watchedIds[videoId]) {
        delete state.watchedIds[videoId];
    } else {
        state.watchedIds[videoId] = true;
    }
    localStorage.setItem("ytWatchedVideos", JSON.stringify(state.watchedIds));
    setTimeout(() => renderApp(), 0);
}

window.closeActiveVideo = function (event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (state.playingVideoId || state.expandedVideoId) {
        if (state.filters.hideWatched && state.playingVideoId) {
            markVideoAsWatched(state.playingVideoId);
        }
        state.playingVideoId = null;
        state.expandedVideoId = null;
        renderApp();
    }
};

// Global Event Delegation for Dynamic Elements
let middleMouseDownItem = null;

videoListEl.addEventListener("mousedown", (event) => {
    if (event.button === 1) {
        middleMouseDownItem = event.target.closest(".video-item") || null;
    }
});

videoListEl.addEventListener("mouseup", (event) => {
    if (event.target.closest(".channel-link")) return;

    const item = event.target.closest(".video-item");
    if (!item) return;
    if (event.button === 1 || event.ctrlKey || event.metaKey) {
        if (event.button === 1 && item !== middleMouseDownItem) return;
        markVideoAsWatched(item.dataset.id);
    }
});

videoListEl.addEventListener("auxclick", (event) => {
    const channelLink = event.target.closest(".channel-link");
    if (!channelLink || event.button !== 1) return;

    const channelUrl = channelLink.dataset.channelUrl;
    if (!channelUrl) return;

    event.preventDefault();
    event.stopPropagation();
    window.open(channelUrl, "_blank", "noopener");
});

videoListEl.addEventListener("click", (event) => {
    const channelLink = event.target.closest(".channel-link");
    if (channelLink) {
        const channelUrl = channelLink.dataset.channelUrl;
        if (channelUrl) {
            event.preventDefault();
            event.stopPropagation();
            window.location.href = channelUrl;
        }
        return;
    }

    const watchedBtn = event.target.closest(".mark-watched-btn");
    if (watchedBtn) {
        const watchedItem = watchedBtn.closest(".video-item");
        if (watchedItem) {
            event.preventDefault();
            event.stopPropagation();
            toggleVideoWatched(watchedItem.dataset.id);
        }
        return;
    }

    const item = event.target.closest(".video-item");
    if (!item) return;

    // Ignore if clicking close button, the onclick handler on the button will catch it
    if (event.target.closest(".close-btn")) return;

    // Standard clicks only
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;

    event.preventDefault();

    if (!state.filters.hideWatched) {
        markVideoAsWatched(item.dataset.id);
    }

    if (state.playingVideoId === item.dataset.id || state.expandedVideoId === item.dataset.id) return;

    closeActiveVideo();

    const videoId = item.dataset.id;
    state.expandedVideoId = videoId;
    renderApp();

    // Trigger iframe expansion smoothly
    setTimeout(() => {
        if (state.expandedVideoId !== videoId) return;
        state.expandedVideoId = null;
        state.playingVideoId = videoId;
        renderApp();

        // Handle responsive fullscreen for mobile shorts
        setTimeout(() => {
            const activeItem = document.querySelector(`.video-item[data-id="${videoId}"]`);
            if (activeItem && activeItem.classList.contains("is-short") && window.innerWidth <= 768) {
                const iframe = activeItem.querySelector("iframe");
                if (iframe) {
                    const requestFS = iframe.requestFullscreen || iframe.webkitRequestFullscreen;
                    if (requestFS) requestFS.call(iframe).catch(() => {});
                }
            }
        }, 100);
    }, 400);
});

// 5. Actions: Data Fetching
async function fetchAllVideos() {
    state.error = null;
    closeActiveVideo();
    renderApp();

    const apiKey = state.apiKey.trim();
    const activeChannels = state.channels.filter((c) => c.enabled && c.value.trim());

    if (!apiKey || activeChannels.length === 0) {
        state.error = "Please enter an API Key and enable at least one channel.";
        renderApp();
        return;
    }

    // Reset data
    state.activeChannels = [];
    state.channelIcons = {};
    state.videos = [];
    state.isFetching = true;
    renderApp();

    try {
        // Find "Uploads" playlist ID for every channel input
        for (const channelObj of activeChannels) {
            const identifier = channelObj.value.trim();
            let queryUrl = identifier.startsWith("@")
                ? `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&forHandle=${identifier}&key=${apiKey}`
                : `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${identifier}&key=${apiKey}`;

            const res = await fetch(queryUrl);
            const data = await res.json();

            if (data.items && data.items.length > 0) {
                const channelData = data.items[0];
                state.channelIcons[channelData.id] = channelData.snippet.thumbnails.default.url;

                // Save resolved channel ID
                channelObj.channelId = channelData.id;

                state.activeChannels.push({
                    playlistId: channelData.contentDetails.relatedPlaylists.uploads,
                    channelId: channelData.id,
                    nextPageToken: "",
                    hasMore: true,
                });
            }
        }
        saveChannels(state.channels);

        if (state.activeChannels.length === 0) throw new Error("No valid channels found.");

        await fetchNextBatch();
    } catch (error) {
        console.error(error);
        state.error = error.message || "An error occurred while fetching videos.";
        state.isFetching = false;
        renderApp();
    }
}

async function fetchNextBatch() {
    const apiKey = state.apiKey.trim();
    state.isFetching = true;
    renderApp();

    try {
        let videoIdsToFetch = [];

        for (const channel of state.activeChannels) {
            if (!channel.hasMore) continue;

            let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${channel.playlistId}&maxResults=10&key=${apiKey}`;
            if (channel.nextPageToken) url += `&pageToken=${channel.nextPageToken}`;

            const plRes = await fetch(url);
            const plData = await plRes.json();

            if (plData.items) {
                plData.items.forEach((item) => videoIdsToFetch.push(item.snippet.resourceId.videoId));
            }

            if (plData.nextPageToken) {
                channel.nextPageToken = plData.nextPageToken;
            } else {
                channel.hasMore = false;
            }
        }

        if (videoIdsToFetch.length === 0) {
            state.isFetching = false;
            renderApp();
            return;
        }

        let newVideos = [];
        for (let i = 0; i < videoIdsToFetch.length; i += 50) {
            const batchIds = videoIdsToFetch.slice(i, i + 50).join(",");
            const statRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,player&maxWidth=1000&maxHeight=1000&id=${batchIds}&key=${apiKey}`,
            );
            const statData = await statRes.json();
            if (statData.items) newVideos.push(...statData.items);
        }

        // Decorate and format video objects natively for our state
        newVideos.forEach((v) => {
            const publishDate = new Date(v.snippet.publishedAt);
            v.timestamp = publishDate.getTime();
            v.exactTimestampStr = publishDate.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
            v.formattedDuration = formatDuration(v.contentDetails.duration);
            v.formattedViews = formatViews(v.statistics.viewCount);

            const embedWidth = parseInt(v.player?.embedWidth) || 16;
            const embedHeight = parseInt(v.player?.embedHeight) || 9;
            const isVertical = embedHeight >= embedWidth;
            v.isShort = isVertical;

            v.thumbUrl = v.snippet.thumbnails.maxres
                ? v.snippet.thumbnails.maxres.url
                : v.snippet.thumbnails.medium.url;

            state.videos.push(v);
        });

        // Deduplicate and sort all memory videos
        const uniqueVideosMap = new Map();
        state.videos.forEach((v) => uniqueVideosMap.set(v.id, v));
        state.videos = Array.from(uniqueVideosMap.values());
        state.videos.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
        console.error(error);
        state.error = error.message;
    } finally {
        state.isFetching = false;
        renderApp();
    }
}

function renderChannels() {
    if (!channelsListContainer) return;

    let html = "";
    
    state.channels.forEach((channel, index) => {
        html += `
            <div class="channel-row">
                <label class="channel-toggle">
                    <input type="checkbox" class="channel-toggle-checkbox" data-index="${index}" ${channel.enabled ? "checked" : ""}>
                    <span class="channel-toggle-ui"></span>
                </label>
                <span class="channel-text" title="${channel.value}">${channel.value}</span>
                <div class="channel-actions">
                    <button class="channel-action-btn btn-delete" data-index="${index}" title="Delete channel">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });

    if (state.showAddRow) {
        html += `
            <div class="channel-row new-row">
                <label class="channel-toggle disabled">
                    <input type="checkbox" disabled>
                    <span class="channel-toggle-ui"></span>
                </label>
                <input type="text" id="new-channel-input" class="channel-input" placeholder="@handle or ID" autocomplete="off">
                <div class="channel-actions">
                    <button class="channel-action-btn btn-check" id="confirm-new-channel" title="Add channel">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button class="channel-action-btn btn-cancel" id="cancel-new-channel" title="Cancel">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    } else {
        html += `
            <button class="add-channel-btn" id="add-channel-trigger" title="Add channel">
                + Add Channel
            </button>
        `;
    }

    channelsListContainer.innerHTML = html;

    const newChannelInput = document.getElementById("new-channel-input");
    if (newChannelInput) {
        newChannelInput.focus();
    }
}

// 6. The Heart of the Pattern: State to UI Render Function
function renderApp() {
    // Render dynamic channel list
    renderChannels();

    // Top-level Error display
    errorContainer.innerText = state.error || "";

    // Loading State
    if (state.isFetching && state.videos.length === 0) {
        loadingIndicator.style.display = "block";
        loadingIndicator.innerText = "Fetching videos...";
        fetchBtn.disabled = true;
    } else {
        loadingIndicator.style.display = "none";
        fetchBtn.disabled = state.isFetching;
    }

    // Determine which videos to display based on the filter states
    const visibleVideos = state.videos.filter((video) => {
        // Hide videos from channels that are not selected (enabled)
        const videoChannelId = video.snippet.channelId;
        const channelConfig = state.channels.find(
            (c) => c.channelId === videoChannelId || c.value === videoChannelId
        );
        if (!channelConfig || !channelConfig.enabled) return false;

        const isWatched = !!state.watchedIds[video.id];
        if (state.filters.mode === "shorts" && !video.isShort) return false;
        if (state.filters.mode === "longs" && video.isShort) return false;
        if (state.filters.hideWatched && isWatched) return false;
        return true;
    });

    // Derive HTML purely from state variables!
    const html = visibleVideos
        .map((video) => {
            const isPlaying = state.playingVideoId === video.id;
            const isExpanding = state.expandedVideoId === video.id;
            const isWatchedClass = state.watchedIds[video.id] ? "is-watched" : "";
            const isShortClass = video.isShort ? "is-short" : "";
            const classes = `video-item ${isWatchedClass} ${isShortClass} ${isPlaying ? "playing" : ""} ${isExpanding ? "expanding" : ""}`;

            if (isPlaying) {
                return `
                <div class="${classes}" data-id="${video.id}">
                    <button class="close-btn" onclick="closeActiveVideo(event)">✕</button>
                    <iframe 
                        src="https://www.youtube.com/embed/${video.id}?autoplay=1" 
                        title="YouTube video player"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                        allowfullscreen>
                    </iframe>
                </div>
            `;
            }

            const iconUrl = state.channelIcons[video.snippet.channelId] || "";
            const publishDate = new Date(video.snippet.publishedAt); // required for dynamic timeSince

            return `
            <a href="https://www.youtube.com/watch?v=${video.id}" class="${classes}" data-id="${video.id}">
                <div class="thumbnail-wrapper">
                    <img class="thumbnail" src="${video.thumbUrl}" alt="Thumbnail">
                    <span class="video-duration">${video.formattedDuration}</span>
                </div>
                <div class="video-details-row">
                    <div class="video-info">
                        <h3 class="video-title">${video.snippet.title}</h3>
                        <div class="channel-info channel-link" data-channel-url="https://www.youtube.com/channel/${video.snippet.channelId}" aria-label="Open channel ${video.snippet.channelTitle}" title="Open channel">
                            ${iconUrl ? `<img class="channel-icon" src="${iconUrl}" alt="Profile">` : ""}
                            <div class="channel-name">${video.snippet.channelTitle}</div>
                        </div>
                        <div class="meta-container">
                            <div class="video-meta">
                                <span>${video.formattedViews}</span>
                                <span>•</span>
                                <span>${timeSince(publishDate)}</span>
                            </div>
                            <div class="upload-timestamp">${video.exactTimestampStr}</div>
                        </div>
                    </div>
                    <span class="mark-watched-btn ${state.watchedIds[video.id] ? "is-marked" : ""}" role="button" aria-label="Mark as watched" title="Mark as watched">
                        <svg class="mark-watched-icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12s-3.8 6.5-10.5 6.5S1.5 12 1.5 12Z"></path>
                            <circle cx="12" cy="12" r="3.25"></circle>
                        </svg>
                    </span>
                </div>
            </a>
        `;
        })
        .join("");

    // Write all changes to the DOM at once
    videoListEl.innerHTML = html;

    // Derived Counter and button visibility
    if (state.videos.length > 0) {
        videoCountText.innerText = `Showing ${visibleVideos.length}/${state.videos.length} videos`;
        const hasMore = state.activeChannels.some((c) => c.hasMore);
        if (hasMore) {
            loadMoreBtn.style.display = "block";
            loadMoreBtn.innerText = state.isFetching ? "Loading older videos..." : "Load More";
            loadMoreBtn.disabled = state.isFetching;
        } else {
            loadMoreBtn.style.display = "none";
        }
    } else {
        videoCountText.innerText = "";
        loadMoreBtn.style.display = "none";
    }
}

// 7. Data Format Utilities
function formatViews(views) {
    if (!views) return "0 views";
    const num = parseInt(views);
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M views";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K views";
    return num.toLocaleString() + " views";
}

function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

function formatDuration(duration) {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return "0:00";
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    let result = "";
    if (hours > 0) {
        result += hours + ":";
        result += minutes.toString().padStart(2, "0") + ":";
    } else {
        result += minutes + ":";
    }
    result += seconds.toString().padStart(2, "0");
    return result;
}
