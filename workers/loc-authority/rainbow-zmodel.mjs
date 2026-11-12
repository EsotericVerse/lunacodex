// Generated from the existing Neon public.rainbow_* catalog on 2026-11-13.
// Better Auth official ZenStack adapter consumes these physical field contracts;
// no runtime introspection, DDL, migrations, or LOC Web models.
export const RAINBOW_MODEL_NAMES=Object.freeze({
  "user": "rainbowUser",
  "session": "rainbowSession",
  "account": "rainbowAccount",
  "verification": "rainbowVerification",
  "jwks": "rainbowJwks",
  "oauthClient": "rainbowOauthClient",
  "oauthResource": "rainbowOauthResource",
  "oauthClientResource": "rainbowOauthClientResource",
  "oauthRefreshToken": "rainbowOauthRefreshToken",
  "oauthAccessToken": "rainbowOauthAccessToken",
  "oauthConsent": "rainbowOauthConsent",
  "oauthClientAssertion": "rainbowOauthClientAssertion"
});
export const RAINBOW_CORE_MODELS=Object.freeze({
  "user": "RainbowUser",
  "session": "RainbowSession",
  "account": "RainbowAccount",
  "verification": "RainbowVerification"
});
export const rainbowSchema={provider:{type:'postgresql',defaultSchema:'public'},
  models:{
  "RainbowUser": {
    "name": "RainbowUser",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "name": {
        "name": "name",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "email": {
        "name": "email",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "emailVerified": {
        "name": "emailVerified",
        "type": "Boolean",
        "attributes": [
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "literal",
                  "value": false
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "literal",
          "value": false
        }
      },
      "image": {
        "name": "image",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "role": {
        "name": "role",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "literal",
                  "value": "user"
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "literal",
          "value": "user"
        }
      },
      "banned": {
        "name": "banned",
        "type": "Boolean",
        "optional": true,
        "attributes": [
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "literal",
                  "value": false
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "literal",
          "value": false
        }
      },
      "banReason": {
        "name": "banReason",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "banExpires": {
        "name": "banExpires",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "email": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_auth"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowSession": {
    "name": "RainbowSession",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "expiresAt": {
        "name": "expiresAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "token": {
        "name": "token",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "ipAddress": {
        "name": "ipAddress",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "userAgent": {
        "name": "userAgent",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "userId": {
        "name": "userId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "impersonatedBy": {
        "name": "impersonatedBy",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "token": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_session"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowAccount": {
    "name": "RainbowAccount",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "accountId": {
        "name": "accountId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "providerId": {
        "name": "providerId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "userId": {
        "name": "userId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "accessToken": {
        "name": "accessToken",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "refreshToken": {
        "name": "refreshToken",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "idToken": {
        "name": "idToken",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "accessTokenExpiresAt": {
        "name": "accessTokenExpiresAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "refreshTokenExpiresAt": {
        "name": "refreshTokenExpiresAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "scope": {
        "name": "scope",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "password": {
        "name": "password",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "providerId_accountId": {
        "providerId": {
          "type": "String"
        },
        "accountId": {
          "type": "String"
        }
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_account"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowVerification": {
    "name": "RainbowVerification",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "identifier": {
        "name": "identifier",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "value": {
        "name": "value",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "expiresAt": {
        "name": "expiresAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_verification"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowJwks": {
    "name": "RainbowJwks",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "publicKey": {
        "name": "publicKey",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "privateKey": {
        "name": "privateKey",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "expiresAt": {
        "name": "expiresAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "alg": {
        "name": "alg",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "crv": {
        "name": "crv",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_jwks"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthClient": {
    "name": "RainbowOauthClient",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientId": {
        "name": "clientId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientSecret": {
        "name": "clientSecret",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientDiscoveryId": {
        "name": "clientDiscoveryId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "disabled": {
        "name": "disabled",
        "type": "Boolean",
        "optional": true,
        "attributes": [
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "literal",
                  "value": false
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "literal",
          "value": false
        }
      },
      "skipConsent": {
        "name": "skipConsent",
        "type": "Boolean",
        "optional": true,
        "attributes": []
      },
      "enableEndSession": {
        "name": "enableEndSession",
        "type": "Boolean",
        "optional": true,
        "attributes": []
      },
      "subjectType": {
        "name": "subjectType",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "scopes": {
        "name": "scopes",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "clientCredentialsScopes": {
        "name": "clientCredentialsScopes",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "userId": {
        "name": "userId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "name": {
        "name": "name",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "uri": {
        "name": "uri",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "icon": {
        "name": "icon",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "contacts": {
        "name": "contacts",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "tos": {
        "name": "tos",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "policy": {
        "name": "policy",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "softwareId": {
        "name": "softwareId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "softwareVersion": {
        "name": "softwareVersion",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "softwareStatement": {
        "name": "softwareStatement",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "redirectUris": {
        "name": "redirectUris",
        "type": "Json",
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "postLogoutRedirectUris": {
        "name": "postLogoutRedirectUris",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "backchannelLogoutUri": {
        "name": "backchannelLogoutUri",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "backchannelLogoutSessionRequired": {
        "name": "backchannelLogoutSessionRequired",
        "type": "Boolean",
        "optional": true,
        "attributes": []
      },
      "tokenEndpointAuthMethod": {
        "name": "tokenEndpointAuthMethod",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "applicationType": {
        "name": "applicationType",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "jwks": {
        "name": "jwks",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "jwksUri": {
        "name": "jwksUri",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "grantTypes": {
        "name": "grantTypes",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "responseTypes": {
        "name": "responseTypes",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "requirePKCE": {
        "name": "requirePKCE",
        "type": "Boolean",
        "optional": true,
        "attributes": []
      },
      "dpopBoundAccessTokens": {
        "name": "dpopBoundAccessTokens",
        "type": "Boolean",
        "optional": true,
        "attributes": []
      },
      "referenceId": {
        "name": "referenceId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "metadata": {
        "name": "metadata",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "clientId": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_client"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthResource": {
    "name": "RainbowOauthResource",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "identifier": {
        "name": "identifier",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "name": {
        "name": "name",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "accessTokenTtl": {
        "name": "accessTokenTtl",
        "type": "Int",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Integer"
          }
        ]
      },
      "refreshTokenTtl": {
        "name": "refreshTokenTtl",
        "type": "Int",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Integer"
          }
        ]
      },
      "signingAlgorithm": {
        "name": "signingAlgorithm",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "signingKeyId": {
        "name": "signingKeyId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "allowedScopes": {
        "name": "allowedScopes",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "customClaims": {
        "name": "customClaims",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "dpopBoundAccessTokensRequired": {
        "name": "dpopBoundAccessTokensRequired",
        "type": "Boolean",
        "optional": true,
        "attributes": [
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "literal",
                  "value": false
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "literal",
          "value": false
        }
      },
      "disabled": {
        "name": "disabled",
        "type": "Boolean",
        "optional": true,
        "attributes": [
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "literal",
                  "value": false
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "literal",
          "value": false
        }
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "policyVersion": {
        "name": "policyVersion",
        "type": "Int",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Integer"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "metadata": {
        "name": "metadata",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "identifier": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_resource"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthClientResource": {
    "name": "RainbowOauthClientResource",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientId": {
        "name": "clientId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "resourceId": {
        "name": "resourceId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "metadata": {
        "name": "metadata",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "clientId_resourceId": {
        "clientId": {
          "type": "String"
        },
        "resourceId": {
          "type": "String"
        }
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_client_resource"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthRefreshToken": {
    "name": "RainbowOauthRefreshToken",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "token": {
        "name": "token",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientId": {
        "name": "clientId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "sessionId": {
        "name": "sessionId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "userId": {
        "name": "userId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "referenceId": {
        "name": "referenceId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "authorizationCodeId": {
        "name": "authorizationCodeId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "resources": {
        "name": "resources",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "requestedUserInfoClaims": {
        "name": "requestedUserInfoClaims",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "expiresAt": {
        "name": "expiresAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "revoked": {
        "name": "revoked",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "rotatedAt": {
        "name": "rotatedAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "rotationReplayResponse": {
        "name": "rotationReplayResponse",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "rotationReplayExpiresAt": {
        "name": "rotationReplayExpiresAt",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "authTime": {
        "name": "authTime",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "confirmation": {
        "name": "confirmation",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "scopes": {
        "name": "scopes",
        "type": "Json",
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "token": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_refresh_token"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthAccessToken": {
    "name": "RainbowOauthAccessToken",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "token": {
        "name": "token",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientId": {
        "name": "clientId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "sessionId": {
        "name": "sessionId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "userId": {
        "name": "userId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "referenceId": {
        "name": "referenceId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "authorizationCodeId": {
        "name": "authorizationCodeId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "resources": {
        "name": "resources",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "requestedUserInfoClaims": {
        "name": "requestedUserInfoClaims",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "refreshId": {
        "name": "refreshId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "expiresAt": {
        "name": "expiresAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "revoked": {
        "name": "revoked",
        "type": "DateTime",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      },
      "confirmation": {
        "name": "confirmation",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "scopes": {
        "name": "scopes",
        "type": "Json",
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      },
      "token": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_access_token"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthConsent": {
    "name": "RainbowOauthConsent",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "clientId": {
        "name": "clientId",
        "type": "String",
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "userId": {
        "name": "userId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "referenceId": {
        "name": "referenceId",
        "type": "String",
        "optional": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "resources": {
        "name": "resources",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "requestedUserInfoClaims": {
        "name": "requestedUserInfoClaims",
        "type": "Json",
        "optional": true,
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "scopes": {
        "name": "scopes",
        "type": "Json",
        "attributes": [
          {
            "name": "@db.JsonB"
          }
        ]
      },
      "createdAt": {
        "name": "createdAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      },
      "updatedAt": {
        "name": "updatedAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          },
          {
            "name": "@default",
            "args": [
              {
                "name": "value",
                "value": {
                  "kind": "call",
                  "function": "dbgenerated",
                  "args": []
                }
              }
            ]
          }
        ],
        "default": {
          "kind": "call",
          "function": "dbgenerated",
          "args": []
        }
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_consent"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  },
  "RainbowOauthClientAssertion": {
    "name": "RainbowOauthClientAssertion",
    "fields": {
      "id": {
        "name": "id",
        "type": "String",
        "id": true,
        "attributes": [
          {
            "name": "@db.Text"
          }
        ]
      },
      "expiresAt": {
        "name": "expiresAt",
        "type": "DateTime",
        "attributes": [
          {
            "name": "@db.Timestamptz"
          }
        ]
      }
    },
    "idFields": [
      "id"
    ],
    "uniqueFields": {
      "id": {
        "type": "String"
      }
    },
    "attributes": [
      {
        "name": "@@map",
        "args": [
          {
            "name": "name",
            "value": {
              "kind": "literal",
              "value": "rainbow_oauth_client_assertion"
            }
          }
        ]
      },
      {
        "name": "@@schema",
        "args": [
          {
            "name": "map",
            "value": {
              "kind": "literal",
              "value": "public"
            }
          }
        ]
      }
    ]
  }
},typeDefs:{},plugins:{}};
