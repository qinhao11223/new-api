package controller

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildUpstreamModelPoolSourcesSeparatesEnabledKeysWithoutExposingSecrets(t *testing.T) {
	channel := &model.Channel{
		Id:      9,
		Name:    "OpenLux",
		Type:    constant.ChannelTypeOpenAI,
		Key:     "secret-first\nsecret-disabled\nsecret-third",
		Status:  common.ChannelStatusEnabled,
		Group:   "default,premium",
		BaseURL: stringPointer("https://api.openlux.ai"),
		ChannelInfo: model.ChannelInfo{
			IsMultiKey: true,
			MultiKeyStatusList: map[int]int{
				1: common.ChannelStatusAutoDisabled,
			},
		},
	}

	sources := buildUpstreamModelPoolSources([]*model.Channel{channel})

	require.Len(t, sources, 2)
	assert.Equal(t, "9:0", sources[0].ID)
	assert.Equal(t, 0, sources[0].KeyIndex)
	assert.Equal(t, "9:2", sources[1].ID)
	assert.Equal(t, 2, sources[1].KeyIndex)
	assert.Equal(t, "api.openlux.ai", sources[0].EndpointHost)
	assert.NotEqual(t, sources[0].KeyFingerprint, sources[1].KeyFingerprint)

	encoded, err := common.Marshal(sources)
	require.NoError(t, err)
	assert.False(t, strings.Contains(string(encoded), "secret-"))
}

func TestResolveUpstreamModelPoolSourceIsolatesSelectedKey(t *testing.T) {
	channel := &model.Channel{
		Id:     7,
		Name:   "GRS AI",
		Type:   constant.ChannelTypeOpenAI,
		Key:    "first-key\nsecond-key",
		Status: common.ChannelStatusEnabled,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey: true,
		},
	}

	source, isolated, key, err := resolveUpstreamModelPoolSource(channel, 1)

	require.NoError(t, err)
	assert.Equal(t, "7:1", source.ID)
	assert.Equal(t, "second-key", key)
	assert.Equal(t, "second-key", isolated.Key)
	assert.False(t, isolated.ChannelInfo.IsMultiKey)
	assert.Equal(t, "first-key\nsecond-key", channel.Key)
}

func TestResolveUpstreamModelPoolSourceRejectsDisabledKey(t *testing.T) {
	channel := &model.Channel{
		Id:     7,
		Key:    "first-key\nsecond-key",
		Status: common.ChannelStatusEnabled,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:         true,
			MultiKeyStatusList: map[int]int{1: common.ChannelStatusAutoDisabled},
		},
	}

	_, _, _, err := resolveUpstreamModelPoolSource(channel, 1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "disabled")
}

func stringPointer(value string) *string {
	return &value
}
