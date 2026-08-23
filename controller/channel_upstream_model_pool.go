package controller

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const upstreamModelPoolDiscoverBatchLimit = 8

var upstreamModelPoolSelectFields = []string{
	"id",
	"name",
	"type",
	"key",
	"status",
	"base_url",
	"models",
	"model_mapping",
	"settings",
	"setting",
	"other",
	"group",
	"tag",
	"channel_info",
	"header_override",
}

type upstreamModelPoolSourceRef struct {
	ChannelID int `json:"channel_id"`
	KeyIndex  int `json:"key_index"`
}

type discoverUpstreamModelPoolRequest struct {
	Sources []upstreamModelPoolSourceRef `json:"sources"`
}

type upstreamModelPoolSource struct {
	ID              string `json:"id"`
	ChannelID       int    `json:"channel_id"`
	ChannelName     string `json:"channel_name"`
	ChannelType     int    `json:"channel_type"`
	ChannelTypeName string `json:"channel_type_name"`
	ChannelGroup    string `json:"channel_group"`
	ChannelTag      string `json:"channel_tag"`
	EndpointHost    string `json:"endpoint_host"`
	KeyIndex        int    `json:"key_index"`
	KeyFingerprint  string `json:"key_fingerprint"`
}

type upstreamModelPoolCandidate struct {
	ID               string `json:"id"`
	Model            string `json:"model"`
	EnabledOnChannel bool   `json:"enabled_on_channel"`
}

type upstreamModelPoolDiscoveryResult struct {
	Source     upstreamModelPoolSource      `json:"source"`
	Models     []upstreamModelPoolCandidate `json:"models"`
	Error      string                       `json:"error,omitempty"`
	DurationMS int64                        `json:"duration_ms"`
}

func upstreamModelPoolSourceID(channelID int, keyIndex int) string {
	return strconv.Itoa(channelID) + ":" + strconv.Itoa(keyIndex)
}

func upstreamModelPoolEndpointHost(channel *model.Channel) string {
	baseURL := channel.GetBaseURL()
	if baseURL == "" && channel.Type >= 0 && channel.Type < len(constant.ChannelBaseURLs) {
		baseURL = constant.ChannelBaseURLs[channel.Type]
	}
	parsed, err := url.Parse(baseURL)
	if err == nil && parsed.Host != "" {
		return parsed.Host
	}
	if baseURL != "" {
		return "custom endpoint"
	}
	return ""
}

func upstreamModelPoolKeyFingerprint(key string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(key)))
	return fmt.Sprintf("%x", digest[:4])
}

func upstreamModelPoolKeyEnabled(channel *model.Channel, keyIndex int) bool {
	if !channel.ChannelInfo.IsMultiKey {
		return keyIndex == 0
	}
	if channel.ChannelInfo.MultiKeyStatusList == nil {
		return true
	}
	status, ok := channel.ChannelInfo.MultiKeyStatusList[keyIndex]
	return !ok || status == common.ChannelStatusEnabled
}

func buildUpstreamModelPoolSource(channel *model.Channel, key string, keyIndex int) upstreamModelPoolSource {
	return upstreamModelPoolSource{
		ID:              upstreamModelPoolSourceID(channel.Id, keyIndex),
		ChannelID:       channel.Id,
		ChannelName:     channel.Name,
		ChannelType:     channel.Type,
		ChannelTypeName: constant.GetChannelTypeName(channel.Type),
		ChannelGroup:    channel.Group,
		ChannelTag:      channel.GetTag(),
		EndpointHost:    upstreamModelPoolEndpointHost(channel),
		KeyIndex:        keyIndex,
		KeyFingerprint:  upstreamModelPoolKeyFingerprint(key),
	}
}

func buildUpstreamModelPoolSources(channels []*model.Channel) []upstreamModelPoolSource {
	sources := make([]upstreamModelPoolSource, 0)
	for _, channel := range channels {
		if channel == nil || channel.Status != common.ChannelStatusEnabled {
			continue
		}
		if !channel.ChannelInfo.IsMultiKey {
			if strings.TrimSpace(channel.Key) != "" {
				sources = append(sources, buildUpstreamModelPoolSource(channel, channel.Key, 0))
			}
			continue
		}
		for keyIndex, key := range channel.GetKeys() {
			if strings.TrimSpace(key) == "" || !upstreamModelPoolKeyEnabled(channel, keyIndex) {
				continue
			}
			sources = append(sources, buildUpstreamModelPoolSource(channel, key, keyIndex))
		}
	}
	sort.Slice(sources, func(i, j int) bool {
		if sources[i].ChannelID == sources[j].ChannelID {
			return sources[i].KeyIndex < sources[j].KeyIndex
		}
		return sources[i].ChannelID < sources[j].ChannelID
	})
	return sources
}

func resolveUpstreamModelPoolSource(channel *model.Channel, keyIndex int) (upstreamModelPoolSource, *model.Channel, string, error) {
	if channel == nil || channel.Status != common.ChannelStatusEnabled {
		return upstreamModelPoolSource{}, nil, "", fmt.Errorf("channel is not enabled")
	}
	keys := []string{channel.Key}
	if channel.ChannelInfo.IsMultiKey {
		keys = channel.GetKeys()
	}
	if keyIndex < 0 || keyIndex >= len(keys) {
		return upstreamModelPoolSource{}, nil, "", fmt.Errorf("key index is out of range")
	}
	if !upstreamModelPoolKeyEnabled(channel, keyIndex) {
		return upstreamModelPoolSource{}, nil, "", fmt.Errorf("key is disabled")
	}
	key := strings.TrimSpace(keys[keyIndex])
	if key == "" {
		return upstreamModelPoolSource{}, nil, "", fmt.Errorf("key is empty")
	}

	isolated := *channel
	isolated.Key = key
	isolated.Keys = nil
	isolated.ChannelInfo.IsMultiKey = false
	isolated.ChannelInfo.MultiKeyStatusList = nil
	isolated.ChannelInfo.MultiKeyDisabledReason = nil
	isolated.ChannelInfo.MultiKeyDisabledTime = nil
	return buildUpstreamModelPoolSource(channel, key, keyIndex), &isolated, key, nil
}

func upstreamModelPoolConfiguredModels(channel *model.Channel) map[string]struct{} {
	configured := make(map[string]struct{})
	for _, modelName := range normalizeModelNames(channel.GetModels()) {
		configured[modelName] = struct{}{}
	}
	for _, target := range normalizeChannelModelMapping(channel) {
		configured[target] = struct{}{}
	}
	return configured
}

func GetUpstreamModelPoolSources(c *gin.Context) {
	var channels []*model.Channel
	err := model.DB.
		Select(upstreamModelPoolSelectFields).
		Where("status = ?", common.ChannelStatusEnabled).
		Order("id asc").
		Find(&channels).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildUpstreamModelPoolSources(channels))
}

func DiscoverUpstreamModelPool(c *gin.Context) {
	var req discoverUpstreamModelPoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(req.Sources) == 0 {
		common.ApiErrorMsg(c, "select at least one upstream source")
		return
	}
	if len(req.Sources) > upstreamModelPoolDiscoverBatchLimit {
		common.ApiErrorMsg(c, fmt.Sprintf("a discovery batch can contain at most %d sources", upstreamModelPoolDiscoverBatchLimit))
		return
	}

	channelIDs := make([]int, 0, len(req.Sources))
	seenRefs := make(map[string]struct{}, len(req.Sources))
	for _, ref := range req.Sources {
		if ref.ChannelID <= 0 || ref.KeyIndex < 0 {
			common.ApiErrorMsg(c, "invalid upstream source")
			return
		}
		refID := upstreamModelPoolSourceID(ref.ChannelID, ref.KeyIndex)
		if _, ok := seenRefs[refID]; ok {
			common.ApiErrorMsg(c, "duplicate upstream source")
			return
		}
		seenRefs[refID] = struct{}{}
		channelIDs = append(channelIDs, ref.ChannelID)
	}

	var channels []*model.Channel
	err := model.DB.
		Select(upstreamModelPoolSelectFields).
		Where("id IN ?", channelIDs).
		Find(&channels).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelByID := make(map[int]*model.Channel, len(channels))
	for _, channel := range channels {
		channelByID[channel.Id] = channel
	}

	results := make([]upstreamModelPoolDiscoveryResult, len(req.Sources))
	var waitGroup sync.WaitGroup
	for index, ref := range req.Sources {
		index, ref := index, ref
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			startedAt := time.Now()
			channel := channelByID[ref.ChannelID]
			source, isolated, key, resolveErr := resolveUpstreamModelPoolSource(channel, ref.KeyIndex)
			result := upstreamModelPoolDiscoveryResult{
				Source: source,
				Models: make([]upstreamModelPoolCandidate, 0),
			}
			defer func() {
				result.DurationMS = time.Since(startedAt).Milliseconds()
				results[index] = result
			}()
			if resolveErr != nil {
				result.Source.ID = upstreamModelPoolSourceID(ref.ChannelID, ref.KeyIndex)
				result.Source.ChannelID = ref.ChannelID
				result.Source.KeyIndex = ref.KeyIndex
				result.Error = resolveErr.Error()
				return
			}

			modelNames, fetchErr := fetchChannelUpstreamModelIDs(isolated)
			if fetchErr != nil {
				result.Error = sanitizeFetchModelsError(fetchErr, key).Error()
				return
			}
			configuredModels := upstreamModelPoolConfiguredModels(channel)
			modelNames = normalizeModelNames(modelNames)
			sort.Strings(modelNames)
			result.Models = make([]upstreamModelPoolCandidate, 0, len(modelNames))
			for _, modelName := range modelNames {
				_, enabled := configuredModels[modelName]
				result.Models = append(result.Models, upstreamModelPoolCandidate{
					ID:               source.ID + ":" + modelName,
					Model:            modelName,
					EnabledOnChannel: enabled,
				})
			}
		}()
	}
	waitGroup.Wait()
	common.ApiSuccess(c, results)
}
